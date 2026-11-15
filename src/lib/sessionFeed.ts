import type { SessionTurn } from './types';

export type TurnDisplayClass = 'voice' | 'dj' | 'track' | 'system';

export const MAX_HOLD_MS = 120_000;

export const MAX_LEAD_SECONDS = 60;

export function airedAtMs(turn: SessionTurn | null | undefined): number | null {
  const raw = turn?.meta?.airedAt;
  if (typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function splitAudibleTurns(
  messages: SessionTurn[] | null | undefined,
  leadMs: number,
  nowMs: number,
): { visible: SessionTurn[]; nextChangeMs: number | null } {
  const visible: SessionTurn[] = [];
  let nextChangeMs: number | null = null;
  for (const turn of messages || []) {
    const at = airedAtMs(turn);
    const audibleAt = at == null ? null : at + Math.max(0, leadMs);
    if (audibleAt == null || audibleAt <= nowMs || audibleAt - nowMs > MAX_HOLD_MS) {
      visible.push(turn);
      continue;
    }
    if (nextChangeMs == null || audibleAt < nextChangeMs) nextChangeMs = audibleAt;
  }
  return { visible, nextChangeMs };
}

export function turnClass(turn: SessionTurn | null | undefined): TurnDisplayClass {
  switch (turn?.role) {
    case 'segment': return 'voice';
    case 'dj':      return 'dj';
    case 'track':   return 'track';
    default:        return 'system';
  }
}

export const isDjTurn = (turn: SessionTurn | null | undefined): boolean => {
  const c = turnClass(turn);
  return c === 'voice' || c === 'dj';
};

export function isShowBoundary(turn: SessionTurn | null | undefined): boolean {
  return turn?.role === 'event' && turn.kind === 'show-boundary';
}

export function isCarriedTurn(turn: SessionTurn | null | undefined): boolean {
  return turn?.meta?.carried === true;
}

export function showBoundaryLabel(
  turn: SessionTurn | null | undefined,
  clock: (at: string) => string,
): string {
  const b = turn?.meta?.boundary as { at?: unknown; show?: unknown; persona?: unknown } | undefined;
  const at = typeof b?.at === 'string' && Number.isFinite(Date.parse(b.at)) ? b.at : null;
  if (!at) return turn?.text || '';
  const name = (typeof b?.show === 'string' && b.show)
    || (typeof b?.persona === 'string' && b.persona)
    || 'On air';
  return `${clock(at)} · ${name}`;
}

export function turnKey(turn: SessionTurn | null | undefined, i: number): string {
  return `${turn?.t || 'x'}-${i}`;
}

export function turnText(turn: SessionTurn | null | undefined): string {
  const text = turn?.text || '';
  if (turnClass(turn) === 'track') return text.replace(/^▶\s*/, '');
  return text;
}

// Pick meta.trackId refers to the next song; skip other track ids (#546).
export function selectThinkingTurn(
  feed: SessionTurn[] | null | undefined,
  currentTrackId: string | null = null,
): SessionTurn | null {
  if (!feed?.length) return null;
  for (let i = feed.length - 1; i >= 0; i--) {
    const turn = feed[i];
    const cls = turnClass(turn);
    if (!turn?.text || (cls !== 'voice' && cls !== 'dj')) continue;
    if (isCarriedTurn(turn)) continue;
    const trackId = turn.meta?.trackId as string | undefined;
    if (cls === 'dj' && trackId && trackId !== currentTrackId) continue;
    return turn;
  }
  return null;
}
