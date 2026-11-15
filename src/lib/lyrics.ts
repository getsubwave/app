import type { LyricsSource, PublicLyricLine, PublicLyricsPayload } from './types';

export const LYRIC_OFFSET_MIN_MS = -30_000;
export const LYRIC_OFFSET_MAX_MS = 30_000;
export const LYRIC_OFFSET_STEP_MS = 50;
export const LYRIC_OFFSET_NUDGE_MS = 100;

export const LYRICS_LAYOUT_HOLD_MS = 1500;

export const LYRICS_MIN_SCREEN_HEIGHT = 700;

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export const PENDING_RECHECK_MS = 4_000;
export const PENDING_MAX_ASKS = 10;

export type LyricsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'disabled'
  | 'gone'
  | 'locked';

export type LyricsResult =
  | { kind: 'ok'; payload: PublicLyricsPayload }
  | { kind: 'disabled' }
  | { kind: 'gone' }
  | { kind: 'locked' }
  | { kind: 'unavailable'; retryAfterSec: number | null };

export const LYRICS_SOURCES: readonly LyricsSource[] = ['music-server', 'lrclib'];

function parseLine(raw: unknown): PublicLyricLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const { startMs, text } = raw as Record<string, unknown>;
  if (typeof text !== 'string') return null;
  if (startMs === null) return { startMs: null, text };
  if (typeof startMs !== 'number' || !Number.isFinite(startMs)) return null;
  return { startMs, text };
}

export function parseLyricsPayload(raw: unknown): PublicLyricsPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const { songId, synced, offsetMs, lines, source, pending } = body;
  if (songId !== null && typeof songId !== 'string') return null;
  if (typeof synced !== 'boolean') return null;
  if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) return null;
  if (!Array.isArray(lines)) return null;
  if (pending !== undefined && typeof pending !== 'boolean') return null;
  const parsed: PublicLyricLine[] = [];
  for (const line of lines) {
    const ok = parseLine(line);
    if (!ok) return null;
    parsed.push(ok);
  }
  const payload: PublicLyricsPayload = { songId, synced, offsetMs, lines: parsed };
  if (source !== undefined) {
    payload.source = LYRICS_SOURCES.includes(source as LyricsSource) ? (source as LyricsSource) : null;
  }
  if (pending !== undefined) payload.pending = pending;
  return payload;
}

export function lyricsResultFor(status: number, retryAfter: string | null, body: unknown): LyricsResult {
  if (status === 403) return { kind: 'disabled' };
  if (status === 409) return { kind: 'gone' };
  if (status === 401) return { kind: 'locked' };
  if (status < 200 || status >= 300) {
    const sec = Number(retryAfter);
    return { kind: 'unavailable', retryAfterSec: Number.isFinite(sec) && sec > 0 ? sec : null };
  }
  const payload = parseLyricsPayload(body);
  return payload ? { kind: 'ok', payload } : { kind: 'unavailable', retryAfterSec: null };
}

export interface LyricsAnswer {
  status: LyricsStatus;
  lyrics: PublicLyricsPayload | null;
}

export interface TrackAnswer extends LyricsAnswer {
  songId: string | null;
}

export function syncedLyricsReady({ status, lyrics }: LyricsAnswer): boolean {
  return status === 'ready' && !!lyrics?.synced && lyrics.lines.length > 0;
}

export function plainLyricsReady({ status, lyrics }: LyricsAnswer): boolean {
  return status === 'ready' && !!lyrics && !lyrics.synced && lyrics.lines.length > 0;
}

export function lyricsNote(track: LyricsAnswer, shown: boolean): string {
  if (!shown) return 'Hidden on this device.';
  const { status, lyrics } = track;
  if (status === 'disabled') return 'The station has lyrics switched off.';
  if (status === 'loading') return 'Looking for lyrics…';
  if (status === 'unavailable') return 'The station isn’t answering. Trying again…';
  if (status === 'idle') return 'No lyrics right now.';
  if (status !== 'ready' || !lyrics) return 'No lyrics for this song.';
  if (syncedLyricsReady(track)) {
    return lyrics.source === 'lrclib' ? 'Synced lyrics, from LRCLIB.' : 'Synced lyrics, from the station’s library.';
  }
  if (plainLyricsReady(track)) {
    return lyrics.pending
      ? 'Untimed for now, still looking for synced ones.'
      : 'Not timed, so they don’t follow the song. Scroll through them.';
  }
  return lyrics.pending ? 'Looking for lyrics…' : 'No lyrics for this song.';
}

export function clampLyricOffsetMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LYRIC_OFFSET_MAX_MS, Math.max(LYRIC_OFFSET_MIN_MS, Math.round(value)));
}

export function formatLyricOffset(ms: number): string {
  if (ms === 0) return '0.00s';
  return `${ms > 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(2)}s`;
}

export function activeLyricLineIndex(
  lyrics: PublicLyricsPayload | null,
  elapsedMs: number,
  offsetMs: number,
): number {
  if (!lyrics?.synced) return -1;
  const adjustedElapsedMs = Math.max(0, elapsedMs + offsetMs);
  let active = -1;
  for (let i = 0; i < lyrics.lines.length; i += 1) {
    const startMs = lyrics.lines[i]?.startMs;
    if (startMs == null) continue;
    if (startMs > adjustedElapsedMs) break;
    active = i;
  }
  return active;
}

const WORD_MS = 380;
const MIN_SUNG_MS = 900;
export const LINE_HOLD_MS = 9_000;
export const TEASE_MS = 3_500;

export interface LyricMoment {
  current: number;
  progress: number;
  next: number;
  resting: boolean;
}

export function lyricMoment(lyrics: PublicLyricsPayload | null, positionMs: number): LyricMoment {
  const lines = lyrics?.synced ? lyrics.lines : [];
  const at = (i: number) => lines[i]?.startMs;
  const firstTimed = lines.findIndex((l) => l.startMs != null);
  if (firstTimed < 0) return { current: -1, progress: 0, next: -1, resting: false };

  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = at(i);
    if (start == null) continue;
    if (start > positionMs) break;
    active = i;
  }
  let following = -1;
  for (let i = active + 1; i < lines.length; i++) {
    if (at(i) != null) {
      following = i;
      break;
    }
  }
  const teased = (i: number) => (i >= 0 && (at(i) as number) - positionMs <= TEASE_MS ? i : -1);

  if (active < 0) return { current: -1, progress: 0, next: teased(firstTimed), resting: true };

  const start = at(active) as number;
  const nextStart = following >= 0 ? (at(following) as number) : Number.POSITIVE_INFINITY;
  if (positionMs - start > LINE_HOLD_MS && nextStart - start > LINE_HOLD_MS) {
    return { current: -1, progress: 0, next: teased(following), resting: true };
  }
  const words = lines[active]?.text.split(/\s+/).filter(Boolean).length || 1;
  const sungMs = Math.min(Math.max(words * WORD_MS, MIN_SUNG_MS), nextStart - start);
  const progress = Math.min(1, Math.max(0, (positionMs - start) / sungMs));
  return { current: active, progress, next: following, resting: false };
}

export function lyricFocusLine(lyrics: PublicLyricsPayload, moment: LyricMoment, positionMs: number): number {
  if (moment.current >= 0) return moment.current;
  return Math.min(lyrics.lines.length - 1, activeLyricLineIndex(lyrics, positionMs, 0) + 1);
}

export function lyricWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function lyricWordParts(text: string): { part: string; index: number }[] {
  const parts: { part: string; index: number }[] = [];
  let words = 0;
  for (const part of text.split(/(\s+)/)) {
    if (part) parts.push({ part, index: part.trim() ? words++ : -1 });
  }
  return parts;
}

export function pendingRecheckDelayMs(asks: number): number | null {
  return asks < PENDING_MAX_ASKS ? PENDING_RECHECK_MS : null;
}

export function lyricsRetryDelayMs(attempt: number, retryAfterSec: number | null): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
  const floor = retryAfterSec != null && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
  return Math.max(backoff, Math.min(floor, RETRY_MAX_MS));
}

export function lyricsSettled(answer: LyricsAnswer): boolean {
  if (answer.status === 'ready') return !answer.lyrics?.pending;
  return answer.status === 'disabled' || answer.status === 'gone' || answer.status === 'locked';
}

export interface LyricsStep {
  answer: (shown: TrackAnswer) => TrackAnswer;
  askAgainMs: number | null;
  recheck: boolean;
}

export function lyricsStep(id: string, result: LyricsResult, attempt: number, pendingAsks: number): LyricsStep {
  if (result.kind === 'ok') {
    if (result.payload.songId !== id) {
      return { answer: () => ({ songId: id, status: 'gone', lyrics: null }), askAgainMs: null, recheck: false };
    }
    const delay = result.payload.pending ? pendingRecheckDelayMs(pendingAsks) : null;
    const payload = result.payload.pending && delay == null ? { ...result.payload, pending: false } : result.payload;
    return { answer: () => ({ songId: id, status: 'ready', lyrics: payload }), askAgainMs: delay, recheck: true };
  }
  if (result.kind !== 'unavailable') {
    const status = result.kind;
    return { answer: () => ({ songId: id, status, lyrics: null }), askAgainMs: null, recheck: false };
  }
  const answer = (shown: TrackAnswer): TrackAnswer => {
    if (shown.songId !== id || !shown.lyrics) return { songId: id, status: 'unavailable', lyrics: null };
    return shown.lyrics.pending ? { ...shown, lyrics: { ...shown.lyrics, pending: false } } : shown;
  };
  return { answer, askAgainMs: lyricsRetryDelayMs(attempt, result.retryAfterSec), recheck: false };
}
