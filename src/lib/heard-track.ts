// Which track a tuned-in listener is hearing. The station reports the live
// edge; the stream reaches the listener stream.bufferSeconds later, so for that
// long after a change they still hear the previous track. useStationFeed
// promotes a new track at audibleAt(); the App Intents (src/intents/on-air.ts)
// answer "what's playing" and "like this song" with heardTrack(), which reads
// the same rule from one /now-playing + /state snapshot. Both measure from the
// buffer less the idle skip's trim (listenerLeadMs).

import { MAX_LEAD_SECONDS } from './sessionFeed';

/** stream.bufferSeconds as milliseconds, clamped to 0–60 s so a bad value
 *  can't park the clock in the far future. Null when the station sent none. */
export function leadMsFrom(bufferSeconds: number | null | undefined): number | null {
  if (typeof bufferSeconds !== 'number' || !Number.isFinite(bufferSeconds)) return null;
  return Math.min(Math.max(bufferSeconds, 0), MAX_LEAD_SECONDS) * 1000;
}

/** How far behind the live edge the listener is: the buffer, less what the
 *  idle skip shed from this connection by playing its silence fast. */
export function listenerLeadMs(bufferMs: number, trimMs: number): number {
  return Math.max(0, bufferMs - Math.max(0, trimMs));
}

// What the idle skip shed from the connection playing now. usePlayer writes it
// beside PlayerScreen's leadTrimMs, and loadAndPlay clears it, so an App
// Intent with no screen to ask (src/intents/on-air.ts) measures from the same
// point the feed does.
let currentTrimMs = 0;

export function setLeadTrimMs(ms: number): void {
  currentTrimMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export function leadTrimMs(): number {
  return currentTrimMs;
}

/** When a track that started at the live edge at `liveStartMs` reaches the
 *  listener. */
export function audibleAt(liveStartMs: number, leadMs: number): number {
  return liveStartMs + leadMs;
}

/** The live track once it is audible, the previous one before that. With no
 *  live-edge start time to measure from, the live track. */
export function heardTrack<T>({
  live,
  previous,
  liveStartMs,
  leadMs,
  now,
}: {
  live: T | null;
  previous: T | null;
  liveStartMs: number | null;
  leadMs: number;
  now: number;
}): T | null {
  if (liveStartMs == null || !Number.isFinite(liveStartMs)) return live;
  return now < audibleAt(liveStartMs, leadMs) ? (previous ?? live) : live;
}
