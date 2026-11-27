// The service shares the app's JS runtime, so this module's handler is the
// mounted player's. iOS runs the service beside the app at startup, and RNTP
// 4.1.2's Android service runs it as a headless task in the app's React
// context. On Android it can also run with no player mounted.

import { splitStationAddress } from './station-credentials';

/** Takes a remote Play; returns false to leave it to the service. */
export type RemotePlayHandler = () => boolean;

let handler: RemotePlayHandler | null = null;

/** The mounted player's claim on remote Plays. Returns the release, which
 *  leaves a later claim in place. */
export function claimRemotePlay(next: RemotePlayHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export interface RemotePlayDeps {
  /** A live stream was loaded and not torn down since (getLastLiveMeta()). */
  hasStream(): boolean;
  /** Reload the last stream with the URL and headers it was loaded with. */
  reloadLast(): Promise<void>;
  /** A plain resume of whatever the native player holds. */
  resume(): Promise<void>;
}

/** service.ts's RemotePlay. A live stream always reloads, which drops the
 *  paused buffer and rejoins the live edge: through the mounted player when
 *  there is one, where a failed load goes to its error backoff, else directly.
 *  With nothing loaded (an in-app stop, a station switch, a Cast handoff) it
 *  only resumes, and so does a failed direct load. */
export async function remotePlay(deps: RemotePlayDeps): Promise<void> {
  try {
    if (deps.hasStream()) {
      if (handler?.()) return;
      await deps.reloadLast();
      return;
    }
  } catch {}
  await deps.resume().catch(() => {});
}

// App Intents (src/intents/tune.ts) hand their tune-ins over the same claim,
// so a mounted player loads every stream through StreamRecovery (CLAUDE.md).

/** Whether a player is mounted to take a tune-in. */
export function playerMounted(): boolean {
  return handler !== null;
}

/** An App Intent's tune-in on the current station, through the mounted player.
 *  False when none is mounted or it has no station: the intent loads itself. */
export function playOnMountedPlayer(): boolean {
  return handler?.() ?? false;
}

// A station switch from an App Intent while the player is mounted. The intent
// writes the store and arms this; StationContext hands the player the new
// station's client, and the player, seeing its base change, takes the tune-in
// in place of the stop a station switch makes.
let arrival: { base: string; settle: (taken: boolean) => void } | null = null;

export interface Arrival {
  /** True once the player took the tune-in; false on cancel or at the cap. */
  taken: Promise<boolean>;
  cancel(): void;
}

/** Arm a tune-in for when the player reaches `base`. One at a time: a newer
 *  switch replaces an older one, which then reads as not taken. */
export function tuneInOnArrival(base: string, timeoutMs: number): Arrival {
  arrival?.settle(false);
  const wanted = splitStationAddress(base).base;
  let settle: (taken: boolean) => void = () => {};
  const taken = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => entry.settle(false), timeoutMs);
  const entry = {
    base: wanted,
    settle: (ok: boolean) => {
      clearTimeout(timer);
      if (arrival === entry) arrival = null;
      settle(ok);
    },
  };
  arrival = entry;
  return { taken, cancel: () => entry.settle(false) };
}

/** The player reached `base`: true, once, when an App Intent asked to tune
 *  in there. */
export function takeArrival(base: string): boolean {
  const pending = arrival;
  if (!pending || pending.base !== splitStationAddress(base).base) return false;
  pending.settle(true);
  return true;
}
