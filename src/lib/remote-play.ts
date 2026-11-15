// The service shares the app's JS runtime, so this module's handler is the
// mounted player's. iOS runs the service beside the app at startup, and RNTP
// 4.1.2's Android service runs it as a headless task in the app's React
// context. On Android it can also run with no player mounted.

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
