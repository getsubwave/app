// Tune in and out on behalf of an App Intent (Siri, Shortcuts, Spotlight, a
// Control), including to another saved station. The decisions are in
// tune-flow.ts; this wires them to the player, the store and the bridge.
// Module-level, not a hook: an intent can launch the app straight into the
// background, where this runs before any screen has mounted, or with none
// mounting at all. usePlayer adopts the audio when it does mount.

import TrackPlayer, { Event, State } from 'react-native-track-player';
import { setOnAir, type IntentReply } from '../../modules/app-intents';
import { isLiveActivitySupported, onLiveActivityStart } from '../../modules/live-activity';
import {
  externalTuneOut,
  getLastLiveMeta,
  isOnAir,
  loadAndPlay,
  playbackStateNow,
  teardown,
} from '@/audio/player';
import { playbackLog } from '@/lib/playback-log';
import {
  playerMounted,
  playOnMountedPlayer,
  tuneInOnArrival,
} from '@/lib/remote-play';
import { announceStationStoreChanged, loadStations, setActiveStation } from '@/lib/station';
import { timeLeft } from './deadline';
import { activeStation } from './station';
import * as flow from './tune-flow';

// How long a tune-in waits for audio before answering, at most. Long enough
// that a refused or unreachable stream is reported to Siri rather than
// silently failing; cut shorter when the bridge's deadline is nearer.
const START_WAIT_MS = 8000;

// How long a tune-in holds its answer, once audio is playing, for
// useLiveActivity to put the card up. ActivityKit only starts one for a
// background app inside a LiveActivityIntent's run (TuneInIntent is one), so
// answering first would close that window. Past the cap, the card comes up
// the next time the app is opened.
const CARD_WAIT_MS = 2000;

const deps: flow.TuneDeps = {
  loadStore: loadStations,
  setActiveStation: async (ref) => {
    await setActiveStation({ url: ref.url, name: ref.name });
  },
  announceSwitch: announceStationStoreChanged,
  onAir: async () => isOnAir(await playbackStateNow()),
  playerMounted,
  playOnMountedPlayer,
  tuneInOnArrival,
  hasStream: () => getLastLiveMeta() !== null,
  reloadLast: async () => {
    const meta = getLastLiveMeta();
    if (meta) await loadAndPlay(meta);
  },
  teardown,
  activeStation: async () => {
    const station = await activeStation();
    if (!station) return null;
    const { api } = station;
    return {
      name: station.name,
      load: () => loadAndPlay({ url: api.streamUrl('mp3'), headers: api.streamHeaders() }),
    };
  },
  startAndWait,
  tuneOut: externalTuneOut,
  setOnAir,
  log: (line) => playbackLog.add(line),
};

export function tuneIn(stationId: string | undefined, deadline: number): Promise<IntentReply> {
  return flow.tuneIn(deps, stationId, deadline);
}

/** A station asked for by name ("Hey Google, play Night Shift on SUB/WAVE"),
 *  as Siri matches one (tune-flow.ts). */
export function tuneInByName(query: string, deadline: number): Promise<IntentReply> {
  return flow.tuneInByName(deps, query, deadline);
}

export function tuneOut(): Promise<IntentReply> {
  return flow.tuneOut(deps);
}

async function startAndWait(start: () => Promise<void>, deadline: number): Promise<boolean> {
  // The card's wait comes out of the budget first; the rest is for audio.
  const startWait = Math.min(START_WAIT_MS, timeLeft(deadline, Date.now()) - CARD_WAIT_MS);
  // Listen before starting so a fast Playing, or a fast card, is not missed.
  const outcome = untilPlaying(Math.max(0, startWait));
  const card = untilCardStarts();
  try {
    await start();
  } catch {
    outcome.cancel();
    card.cancel();
    return false;
  }
  if (!(await outcome.result)) {
    card.cancel();
    return false;
  }
  await Promise.race([card.result, wait(timeLeft(deadline, Date.now()))]);
  card.cancel();
  return true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Settles once: on `done(value)`, or with `onTimeout` at the cap. `listen`
 *  subscribes and returns the unsubscribe, run on settling. */
function settleOnce<T>(
  timeoutMs: number,
  onTimeout: T,
  listen: (done: (value: T) => void) => () => void,
): { result: Promise<T>; cancel: (value: T) => void } {
  let settle: (value: T) => void = () => {};
  const result = new Promise<T>((resolve) => {
    settle = resolve;
  });
  let finished = false;
  let unsubscribe: () => void = () => {};
  const done = (value: T) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    unsubscribe();
    settle(value);
  };
  const timer = setTimeout(() => done(onTimeout), timeoutMs);
  unsubscribe = listen(done);
  if (finished) unsubscribe();
  return { result, cancel: done };
}

/** Settles on the next Live Activity start attempt, whatever its outcome,
 *  or at the cap. Immediately where there is no card to wait for. */
function untilCardStarts(): { result: Promise<void>; cancel: () => void } {
  if (!isLiveActivitySupported()) return { result: Promise.resolve(), cancel: () => {} };
  const s = settleOnce<void>(CARD_WAIT_MS, undefined, (done) => onLiveActivityStart(() => done()));
  return { result: s.result, cancel: () => s.cancel() };
}

/** True on Playing; false on an error. Still buffering when the wait runs out
 *  counts as started: the player keeps trying, and usePlayer's watchdog takes
 *  over once a screen mounts. */
function untilPlaying(timeoutMs: number): { result: Promise<boolean>; cancel: () => void } {
  const s = settleOnce<boolean>(timeoutMs, true, (done) => {
    const subs = [
      TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
        if (state === State.Playing) done(true);
        else if (state === State.Error) done(false);
      }),
      TrackPlayer.addEventListener(Event.PlaybackError, () => done(false)),
    ];
    return () => subs.forEach((sub) => sub.remove());
  });
  return { result: s.result, cancel: () => s.cancel(false) };
}
