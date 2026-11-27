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

import type { IntentReply } from '../../modules/app-intents';

/** A car has no Siri reply window to fit: a pick may take as long as a
 *  tune-in waits for audio. */
export const CAR_PICK_BUDGET_MS = 10_000;

export interface CarPick {
  /** For the playback log: what was picked. */
  label: string;
  /** Tune in, answering by `deadline` (epoch ms). */
  tune(deadline: number): Promise<IntentReply>;
}

export interface CarPicks {
  /** A pick from the car. Tunes in now, or holds it when only preparing. */
  pick(pick: CarPick, playWhenReady: boolean): Promise<void>;
  /** A Play from the car or a remote. Tunes in to a held pick and returns
   *  true; false when none is held, for the usual remote Play. */
  playPrepared(): boolean;
  /** Pause or stop: a held pick is dropped. */
  forget(): void;
}

export function createCarPicks(log: (msg: string) => void, now: () => number = Date.now): CarPicks {
  let prepared: CarPick | null = null;

  async function run(pick: CarPick): Promise<void> {
    try {
      // From when it runs: a prepared pick may wait a while for its Play.
      const reply = await pick.tune(now() + CAR_PICK_BUDGET_MS);
      if (!reply.ok) log(`car ${pick.label} refused: ${reply.message ?? 'no reason'}`);
    } catch (e) {
      log(`car ${pick.label} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    pick(pick, playWhenReady) {
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
      void run(pick);
      return true;
    },
    forget() {
      prepared = null;
    },
  };
}
