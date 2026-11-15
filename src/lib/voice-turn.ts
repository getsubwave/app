import { MAX_HOLD_MS, airedAtMs, isCarriedTurn } from './sessionFeed';
import type { SessionTurn } from './types';

const VOICE_TURN_KINDS = new Set([
  'voice',
  'segment',
  'link',
  'intro',
  'station-id',
  'weather',
  'hourly',
  'say',
]);

export function isVoiceTurn(turn: SessionTurn | undefined): boolean {
  if (!turn) return false;
  const kind = (turn.kind || '').toLowerCase();
  if (VOICE_TURN_KINDS.has(kind)) return true;
  const role = (turn.role || '').toLowerCase();
  return role === 'voice' || role === 'segment';
}

export function speechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(45_000, Math.max(3_000, Math.round((words / 2.6) * 1000) + 1_200));
}

const MAX_CLIP_MS = 15 * 60_000;

export function lineMs(turn: SessionTurn): number {
  const d = turn.meta?.durationMs;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0 && d <= MAX_CLIP_MS) return d;
  return speechMs(turn.text || '');
}

export function talkingState(
  feed: SessionTurn[] | null | undefined,
  leadMs: number,
  nowMs: number,
): { talking: boolean; nextChangeMs: number | null } {
  const turns = feed ?? [];
  let pendingMs: number | null = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!isVoiceTurn(turn) || isCarriedTurn(turn)) continue;
    const stamp =
      airedAtMs(turn) ??
      (typeof turn.t === 'number' ? turn.t : typeof turn.t === 'string' ? Date.parse(turn.t) : NaN);
    if (!Number.isFinite(stamp)) continue;
    const startMs = stamp + Math.max(0, leadMs);
    if (startMs > nowMs) {
      if (startMs - nowMs <= MAX_HOLD_MS && (pendingMs == null || startMs < pendingMs)) {
        pendingMs = startMs;
      }
      continue;
    }
    const endMs = startMs + lineMs(turn);
    if (nowMs < endMs) {
      return { talking: true, nextChangeMs: pendingMs == null ? endMs : Math.min(endMs, pendingMs) };
    }
    break;
  }
  return { talking: false, nextChangeMs: pendingMs };
}
