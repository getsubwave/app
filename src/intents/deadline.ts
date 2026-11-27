// When an App Intent's answer must be in. The Swift bridge gives up on JS at
// its reply window (SubwaveIntentBridge.swift) and Siri then says the app
// didn't respond, even for work that went through, so every wait in
// src/intents/ is cut to fit. Pure, so scripts/intent-tune.test.ts can drive it.

/** Kept back for the reply's trip to Swift and the bridge's 200 ms poll. */
export const REPLY_MARGIN_MS = 1500;

/** A request that names no deadline (a binary from before the bridge sent
 *  one) is assumed to have spent the bridge's whole 10 s ack window booting,
 *  out of its 20 s: the worst case. */
export const FALLBACK_BUDGET_MS = 10_000;

/** Never trusted for longer than this: a clock change on the device mid-intent
 *  must not hold Siri open. */
const MAX_BUDGET_MS = 30_000;

/** The moment, in epoch ms, by which JS must have answered: the bridge's own
 *  deadline less the margin, or the fallback from when JS received it. */
export function intentDeadline(sent: unknown, receivedAt: number): number {
  if (typeof sent !== 'number' || !Number.isFinite(sent)) {
    return receivedAt + FALLBACK_BUDGET_MS - REPLY_MARGIN_MS;
  }
  return Math.min(sent, receivedAt + MAX_BUDGET_MS) - REPLY_MARGIN_MS;
}

/** What is left of the budget, never negative. */
export function timeLeft(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}

export const TIMED_OUT: unique symbol = Symbol('timed out');

/** `work`, or TIMED_OUT once `wait` settles first. `wait` is a timer, so a
 *  test can hand in one it controls. */
export function within<T>(work: Promise<T>, wait: Promise<void>): Promise<T | typeof TIMED_OUT> {
  return Promise.race([work, wait.then((): typeof TIMED_OUT => TIMED_OUT)]);
}
