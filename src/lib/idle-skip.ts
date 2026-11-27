// How much of a woken station's stale idle silence this listener may skip
// (#9), the app's port of web/lib/idleSkip.ts (perminder-klair/subwave#2125).
// Keep the two in step: the reasoning behind each rule is in the web file's
// header. In short, while the idle gate holds the programme every mount serves
// silence, so a woken station's connect burst is bufferSeconds of it. The
// listener may close up on the live edge through that silence, never past the
// first music on either side of the pause, never nearer than the cushion, and
// only when the pause predates the connection by more than any burst the mounts
// can render. Server ages and local clock readings are never compared, and each
// is widened in the direction that skips less. Anything missing, malformed or
// out of order skips nothing.

import type { IdleWindow } from './types';

/** The longest burst the mounts can render, whatever is advertised: the
 *  controller's upper bound for stream.bufferSeconds, which the broadcast
 *  image also clamps the rendered burst to. */
export const MAX_BURST_SECONDS = 60;
/** Silence kept ahead of the listener after a skip: their stall cushion. */
export const SKIP_CUSHION_SECONDS = 5;
/** How far short of the first music (either side of the pause) a skip stops. */
export const MUSIC_MARGIN_SECONDS = 1;
/** A smaller skip isn't worth moving the listener's offset for. */
export const MIN_SKIP_SECONDS = 1;

export interface IdleSkipInput {
  /** The station's advertised stream.bufferSeconds. */
  bufferSeconds: number | null | undefined;
  /** `streamIdleWindow` from a /state read made for this connection. */
  window: IdleWindow | null | undefined;
  /** Local ms when the stream request went out. */
  requestedAt: number;
  /** Local ms when the first audio arrived. */
  firstAudioAt: number;
  /** Local ms when the /state read was sent, and when it came back. */
  readSentAt: number;
  readReceivedAt: number;
  /** Local ms now. */
  now: number;
}

const finiteAge = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Seconds of lag this listener may shed at `input.now`; 0 means leave the
 *  stream alone. */
export function idleSkipSeconds(input: IdleSkipInput): number {
  const { bufferSeconds: buffer, window, requestedAt, firstAudioAt, readSentAt, readReceivedAt, now } = input;
  if (typeof buffer !== 'number' || !Number.isFinite(buffer) || buffer <= SKIP_CUSHION_SECONDS) return 0;
  if (!window || !finiteAge(window.startedMsAgo)) return 0;
  const ended = window.endedMsAgo;
  if (ended !== null && (!finiteAge(ended) || ended > window.startedMsAgo)) return 0;
  if (![requestedAt, firstAudioAt, readSentAt, readReceivedAt, now].every(Number.isFinite)) return 0;
  if (firstAudioAt < requestedAt || readSentAt < firstAudioAt || readReceivedAt < readSentAt || now < readReceivedAt) return 0;

  // Against the longest burst the mounts can render, never the advertised one,
  // which can be shorter than the running mounts' (header).
  const pausedBeforeConnect = (window.startedMsAgo - (readReceivedAt - requestedAt)) / 1000;
  if (pausedBeforeConnect < Math.max(buffer, MAX_BURST_SECONDS) + MUSIC_MARGIN_SECONDS) return 0;

  const resumedAgo = ((ended ?? 0) + (now - readSentAt)) / 1000;
  const keep = Math.max(SKIP_CUSHION_SECONDS, resumedAgo + MUSIC_MARGIN_SECONDS);
  const skip = buffer - keep;
  return skip >= MIN_SKIP_SECONDS ? skip : 0;
}
