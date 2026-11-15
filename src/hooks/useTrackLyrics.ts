import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StationApi } from '@/lib/api';
import {
  clampLyricOffsetMs,
  lyricsSettled,
  lyricsStep,
  type LyricsAnswer,
  type TrackAnswer,
} from '@/lib/lyrics';
import { loadLyricsDeviceOffset, saveLyricsDeviceOffset } from '@/lib/lyrics-prefs';

export interface TrackLyrics extends LyricsAnswer {
  deviceOffsetMs: number;
  setDeviceOffsetMs: (next: number) => void;
}

const IDLE: TrackAnswer = { songId: null, status: 'idle', lyrics: null };

export function useTrackLyrics(
  api: StationApi | null,
  songId: string | null | undefined,
  active: boolean,
): TrackLyrics {
  const id = (api && songId) || null;
  const [answer, setAnswer] = useState<TrackAnswer>(IDLE);
  const answerRef = useRef(answer);
  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);
  const [deviceOffsetMs, setDeviceOffsetState] = useState(0);
  const lastRunRef = useRef({ api, id });
  const rechecksRef = useRef({ songId: null as string | null, asks: 0 });

  useEffect(() => {
    let cancelled = false;
    void loadLyricsDeviceOffset().then((v) => {
      if (!cancelled) setDeviceOffsetState(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const last = lastRunRef.current;
    lastRunRef.current = { api, id };
    if (!api || !id) {
      setAnswer(IDLE);
      return;
    }
    if (!active) return;
    if (last.api !== api && last.id === id) return;
    const held = answerRef.current;
    if (held.songId === id && lyricsSettled(held)) return;
    if (rechecksRef.current.songId !== id) rechecksRef.current = { songId: id, asks: 0 };
    const rechecks = rechecksRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    if (held.songId !== id) setAnswer({ songId: id, status: 'loading', lyrics: null });
    const ask = async () => {
      const result = await api.currentLyrics(id);
      if (cancelled) return;
      const step = lyricsStep(id, result, attempt, rechecks.asks);
      setAnswer(step.answer);
      if (step.askAgainMs == null) return;
      if (step.recheck) rechecks.asks += 1;
      else attempt += 1;
      timer = setTimeout(ask, step.askAgainMs);
    };
    void ask();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, id, active]);

  const current: TrackAnswer = answer.songId === id
    ? answer
    : { songId: id, status: id ? 'loading' : 'idle', lyrics: null };

  const setDeviceOffsetMs = useCallback((next: number) => {
    const clamped = clampLyricOffsetMs(next);
    setDeviceOffsetState(clamped);
    void saveLyricsDeviceOffset(clamped);
  }, []);

  const { status, lyrics } = current;
  return useMemo(
    () => ({ status, lyrics, deviceOffsetMs, setDeviceOffsetMs }),
    [status, lyrics, deviceOffsetMs, setDeviceOffsetMs],
  );
}

export function useLyricClock(
  track: TrackLyrics,
  trackStartedAt: number | null,
  running: boolean,
  tickMs = 500,
): number {
  const synced = !!track.lyrics?.synced;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!synced || !running) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [synced, running, trackStartedAt, tickMs]);
  const elapsedMs = trackStartedAt == null ? 0 : Math.max(0, nowMs - trackStartedAt);
  return elapsedMs + (track.lyrics?.offsetMs ?? 0) + track.deviceOffsetMs;
}
