// Android Auto's picks: a station tapped in the car's list, or asked for by
// voice, arriving in service.ts as remote-play-id / remote-play-search.
//
// A pick can be a prepare (playWhenReady false): Android expects that to get
// ready without starting audio, and a live stream has nothing worth loading
// paused, so the pick is held and the next Play tunes in to it instead of
// resuming. Failures land in the playback log, never in silence.
//
// A pick tunes in through src/intents/tune-flow.ts, as Siri does: handed to
// the mounted player, and so to StreamRecovery, whenever one is mounted.
//
// A pick that fails shows the car why, in place of Now Playing
// (src/intents/car-errors.ts); the next pick clears it, and so does audio
// playing (the RNTP patch's MediaBrowserBridge).

import { carErrorFor, type CarError } from './car-errors';
import type { TuneReply } from './tune-flow';

/** A car has no Siri reply window to fit: a pick may take as long as a
 *  tune-in waits for audio. */
export const CAR_PICK_BUDGET_MS = 10_000;

export interface CarPick {
  /** For the playback log: what was picked. */
  label: string;
  /** Tune in, answering by `deadline` (epoch ms). */
  tune(deadline: number): Promise<TuneReply>;
}

/** The car's error state (modules/android-auto). */
export interface CarScreen {
  show(error: CarError): void;
  clear(): void;
  /** Whether the station a failed stream was for needs a password the app
   *  doesn't have (tune.ts activeStationLocked). */
  locked(): Promise<boolean>;
}

const NO_SCREEN: CarScreen = {
  show: () => {},
  clear: () => {},
  locked: async () => false,
};

export interface CarPicks {
  /** A pick from the car. Tunes in now, or holds it when only preparing. */
  pick(pick: CarPick, playWhenReady: boolean): Promise<void>;
  /** A Play from the car or a remote. Tunes in to a held pick and returns
   *  true; false when none is held, for the usual remote Play. */
  playPrepared(): boolean;
  /** Pause or stop: a held pick is dropped. */
  forget(): void;
}

export function createCarPicks(
  log: (msg: string) => void,
  now: () => number = Date.now,
  screen: CarScreen = NO_SCREEN,
): CarPicks {
  let prepared: CarPick | null = null;
  // Each pick's number: only the latest one's failure reaches the car.
  let latest = 0;

  async function show(pick: number, reply: TuneReply): Promise<void> {
    const locked = reply.reason === 'unreachable' && (await screen.locked().catch(() => false));
    if (pick !== latest) return;
    const error = carErrorFor(reply, locked);
    log(`car error shown: ${error.kind}`);
    screen.show(error);
  }

  async function run(pick: CarPick): Promise<void> {
    const n = latest;
    try {
      // From when it runs: a prepared pick may wait a while for its Play.
      const reply = await pick.tune(now() + CAR_PICK_BUDGET_MS);
      if (reply.ok) return;
      log(`car ${pick.label} refused: ${reply.message ?? 'no reason'}`);
      await show(n, reply);
    } catch (e) {
      log(`car ${pick.label} failed: ${e instanceof Error ? e.message : String(e)}`);
      await show(n, { ok: false, reason: 'unreachable' });
    }
  }

  /** A new pick: the car's last error is old news. */
  function next(): void {
    latest += 1;
    screen.clear();
  }

  return {
    pick(pick, playWhenReady) {
      next();
      if (!playWhenReady) {
        prepared = pick;
        log(`car ${pick.label} prepared`);
        return Promise.resolve();
      }
      prepared = null;
      return run(pick);
    },
    playPrepared() {
      const pick = prepared;
      if (!pick) return false;
      prepared = null;
      next();
      void run(pick);
      return true;
    },
    forget() {
      prepared = null;
    },
  };
}
