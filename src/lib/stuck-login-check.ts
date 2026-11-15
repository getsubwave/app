import type { HealthResult } from './api';
import { loginRefused } from './station-login';

export const STUCK_RECHECK_MS = 8_000;
export const RECHECK_MIN_GAP_MS = 30_000;

/** Check while stuck until the station refuses the login, then call
 *  `onRefused` once and stop. The first check waits STUCK_RECHECK_MS, and no
 *  check starts sooner than RECHECK_MIN_GAP_MS after the last one of any kind
 *  (`lastCheckAt`). One runs at a time: the next is armed only once an answer
 *  is in. Returns the cancel, for when the player comes unstuck or the station
 *  changes; an answer that lands after it, or one for a client that is no
 *  longer `current`, is dropped and asks nothing more. */
export function watchStuckLogin(deps: {
  /** GET /api/health with the saved login. Never throws. Stamps the time
   *  `lastCheckAt` reads. */
  probe: () => Promise<HealthResult>;
  /** When the last check began, here or elsewhere (the visit check, Try again). */
  lastCheckAt: () => number;
  /** Whether the client this was armed with is still the station's. */
  current: () => boolean;
  onRefused: () => void;
}): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const wait = Math.max(STUCK_RECHECK_MS, deps.lastCheckAt() + RECHECK_MIN_GAP_MS - Date.now());
    timer = setTimeout(() => {
      void deps.probe().then((result) => {
        if (!alive || !deps.current()) return;
        if (loginRefused(result)) deps.onRefused();
        else arm();
      });
    }, wait);
  };
  arm();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}
