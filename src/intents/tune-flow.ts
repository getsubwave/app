// How an App Intent tunes in and out: which station, and who loads it. Pure,
// so scripts/intent-tune.test.ts can drive it; src/intents/tune.ts wires it to
// the player, the station store and the bridge.
//
// While the player is mounted every load goes through it, and so through
// StreamRecovery (CLAUDE.md): one at a time, with its watchdog, backoff and
// idle skip. Only with no player mounted, as after a cold Siri launch, does
// the intent load the stream itself; usePlayer adopts it when it mounts. A
// station switch with the player mounted writes the store and lets the player
// tune in once StationContext hands it the new station.

import type { IntentReply } from '../../modules/app-intents';
import { splitStationAddress, type StoredStationRef } from '../lib/station-credentials';
import { findSavedStation, matchStations, stationsForSiri } from '../lib/station-store';
import { NO_STATION_MESSAGE } from './station-messages';

export const NOT_SAVED_MESSAGE = "That station isn't saved in SUB/WAVE. Add it in the app first.";

/** How long a switch waits for StationContext to hand the player the new
 *  station: a store read and a render. */
export const ARRIVAL_WAIT_MS = 3000;

export interface TuneDeps {
  loadStore(): Promise<{ activeStation: string | null; recents: StoredStationRef[] }>;
  setActiveStation(ref: StoredStationRef): Promise<void>;
  /** Tells StationContext the store changed. */
  announceSwitch(): void;
  /** The stream is playing or on its way (isOnAir). */
  onAir(): Promise<boolean>;
  playerMounted(): boolean;
  /** Hand a tune-in on the current station to the mounted player. */
  playOnMountedPlayer(): boolean;
  /** Arm the mounted player to tune in when it reaches `base`. */
  tuneInOnArrival(base: string, timeoutMs: number): { taken: Promise<boolean>; cancel(): void };
  /** A live stream was loaded and not torn down since. */
  hasStream(): boolean;
  /** Direct loads, for when no player is mounted. */
  reloadLast(): Promise<void>;
  teardown(): Promise<void>;
  /** The active station's name and a direct load of its MP3 mount. */
  activeStation(): Promise<{ name: string | null; load(): Promise<void> } | null>;
  /** Runs `start`, listening first; true once the stream plays and the Live
   *  Activity has had its chance, false if it fails or `start` throws. */
  startAndWait(start: () => Promise<void>, deadline: number): Promise<boolean>;
  tuneOut(): Promise<void>;
  /** The tune control's state (Control Center, Lock Screen, Action button). */
  setOnAir(onAir: boolean): void;
  log(line: string): void;
}

/** Tune in to `stationId` (a saved station's base, as Siri and Spotlight know
 *  it), or to the station listened to last when there is none. */
export async function tuneIn(
  deps: TuneDeps,
  stationId: string | undefined,
  deadline: number,
): Promise<IntentReply> {
  if (stationId) {
    const store = await deps.loadStore();
    const wanted = findSavedStation(store.recents, stationId);
    if (!wanted) return { ok: false, message: NOT_SAVED_MESSAGE };
    const active = store.activeStation ? splitStationAddress(store.activeStation).base : null;
    if (splitStationAddress(wanted.url).base !== active) return switchTo(deps, wanted, deadline);
  }

  if (await deps.onAir()) {
    deps.setOnAir(true);
    return { ok: true };
  }

  // Warm: the same reload a lock-screen Play does (service.ts).
  if (deps.hasStream()) {
    return started(deps, null, await deps.startAndWait(() => load(deps, deps.reloadLast), deadline));
  }

  // Cold, or after an in-app stop: the stored station. Always the MP3 mount
  // when loaded here: a stored format preference is only honoured once the
  // station's feed confirms the mount, and usePlayer retunes onto it then.
  const station = await deps.activeStation();
  if (!station) return { ok: false, message: NO_STATION_MESSAGE };
  return started(
    deps,
    station.name,
    await deps.startAndWait(() => load(deps, station.load), deadline),
  );
}

/** A station asked for by name ("Hey Google, play Night Shift on SUB/WAVE"),
 *  matched as Siri matches one. No name, or none that matches, tunes in to
 *  the station listened to last. The same routing as tuneIn. */
export async function tuneInByName(
  deps: TuneDeps,
  query: string,
  deadline: number,
): Promise<IntentReply> {
  const store = await deps.loadStore();
  const [match] = matchStations(stationsForSiri(store.recents), query);
  return tuneIn(deps, match?.id, deadline);
}

/** Through the mounted player when there is one, else directly. */
async function load(deps: TuneDeps, direct: () => Promise<void>): Promise<void> {
  if (deps.playOnMountedPlayer()) {
    deps.log('intent tune-in: handed to the player');
    return;
  }
  deps.log('intent tune-in: no player mounted, loading directly');
  await direct();
}

/** Another saved station. */
async function switchTo(
  deps: TuneDeps,
  ref: StoredStationRef,
  deadline: number,
): Promise<IntentReply> {
  const base = splitStationAddress(ref.url).base;
  await deps.setActiveStation(ref);

  if (deps.playerMounted()) {
    // The player stops the old station and tunes in to this one when its
    // base changes; armed first, so a fast store read is not missed.
    deps.log('intent station switch: handed to the player');
    const arrival = deps.tuneInOnArrival(base, ARRIVAL_WAIT_MS);
    deps.announceSwitch();
    const ok = await deps.startAndWait(async () => {
      if (!(await arrival.taken)) throw new Error('the player did not reach the station');
    }, deadline);
    arrival.cancel();
    return started(deps, ref.name, ok);
  }

  // No player: stop the old stream, start the new one, and tell
  // StationContext only once it is loaded, so that when the screens' base
  // changes the stream playing already belongs to it and usePlayer keeps it
  // (streamBelongsTo) instead of stopping a stale one.
  deps.log('intent station switch: no player mounted, loading directly');
  await deps.teardown();
  const station = await deps.activeStation();
  if (!station) {
    deps.announceSwitch();
    return { ok: false, message: NO_STATION_MESSAGE };
  }
  const ok = await deps.startAndWait(async () => {
    try {
      await station.load();
    } finally {
      // The station switched even if its stream did not start.
      deps.announceSwitch();
    }
  }, deadline);
  return started(deps, station.name ?? ref.name, ok);
}

function started(deps: TuneDeps, stationName: string | null, ok: boolean): IntentReply {
  // With a player mounted it owns the control's state, failures included: it
  // stays tuned in through its own backoff.
  if (ok) deps.setOnAir(true);
  else if (!deps.playerMounted()) deps.setOnAir(false);
  return ok ? { ok: true } : failed(stationName);
}

export function failed(stationName: string | null): IntentReply {
  const station = stationName ?? 'the station';
  return {
    ok: false,
    message: `Couldn't reach ${station}. If it's private, open SUB/WAVE to unlock it.`,
  };
}

export async function tuneOut(deps: TuneDeps): Promise<IntentReply> {
  deps.log('intent tune-out');
  await deps.tuneOut().catch(() => {});
  deps.setOnAir(false);
  return { ok: true };
}
