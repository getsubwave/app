import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppActive } from '@/hooks/useAppActive';
import type { StationApi } from '@/lib/api';
import { feedState } from '@/lib/feed-state';
import { pollAsync } from '@/lib/poll';
import { DEFAULT_STATION_LOCALE, type StationLocale } from '@/lib/format';
import { MAX_LEAD_SECONDS, splitAudibleTurns } from '@/lib/sessionFeed';
import { trackElapsedSeconds } from '@/lib/track-progress';
import type {
  ActiveShow,
  DjState,
  ListenerCount,
  NowPlayingResponse,
  NowPlayingTrack,
  SessionPayload,
  StationContext,
  StationState,
  StreamInfo,
} from '@/lib/types';

export interface StationFeed {
  nowPlaying: NowPlayingTrack | null;
  context: StationContext | null;
  dj: DjState | null;
  activeShow: ActiveShow | null;
  listeners: ListenerCount | number | null;
  streamOnline: boolean | null;
  streamInfo: StreamInfo | null;
  llmTokens: number | null;
  state: StationState;
  session: SessionPayload;
  leadMs: number;
  elapsed: number;
  progress: number;
  trackStartedAt: number | null;
  timezone: string | null;
  locale: StationLocale;
}

const EMPTY_STATE: StationState = { upcoming: [], history: [] };
const EMPTY_SESSION: SessionPayload = { session: null, messages: [] };
const OFFLINE_CONFIRM_POLLS = 4;

export function useStationFeed(
  api: StationApi | null,
  opts?: { backgroundPoll?: boolean; leadTrimMs?: number },
): StationFeed {
  const backgroundPoll = opts?.backgroundPoll ?? false;
  const leadTrimMs = Math.max(0, opts?.leadTrimMs ?? 0);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  const [context, setContext] = useState<StationContext | null>(null);
  const [dj, setDj] = useState<DjState | null>(null);
  const [activeShow, setActiveShow] = useState<ActiveShow | null>(null);
  const [listeners, setListeners] = useState<ListenerCount | number | null>(null);
  const [streamOnline, setStreamOnline] = useState<boolean | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [llmTokens, setLlmTokens] = useState<number | null>(null);
  const [state, setState] = useState<StationState>(EMPTY_STATE);
  const [session, setSession] = useState<SessionPayload>(EMPTY_SESSION);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [locale, setLocale] = useState<StationLocale>(DEFAULT_STATION_LOCALE);
  const [elapsed, setElapsed] = useState(0);
  const trackStartRef = useRef<number | null>(null);
  const [trackStartedAt, setTrackStartedAt] = useState<number | null>(null);
  const offlinePollsRef = useRef(0);
  const appActive = useAppActive();
  const lastTrackKeyRef = useRef<string | null>(null);
  const bufferMsRef = useRef(0);
  const trimMsRef = useRef(0);
  const leadMsRef = useRef(0);
  const [leadMs, setLeadMs] = useState(0);
  const promoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawSessionRef = useRef<SessionPayload>(EMPTY_SESSION);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sigRef = useRef<Record<string, string>>({});
  const setIfChanged = useCallback(<T,>(key: string, value: T, set: (v: T) => void) => {
    const sig = JSON.stringify(value) ?? 'null';
    if (sigRef.current[key] === sig) return;
    sigRef.current[key] = sig;
    set(value);
  }, []);

  const applySession = useCallback(() => {
    const run = () => {
      const raw = rawSessionRef.current;
      const now = Date.now();
      const { visible, nextChangeMs } = splitAudibleTurns(raw.messages, leadMsRef.current, now);
      setIfChanged('session', { session: raw.session, messages: visible }, setSession);
      if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current =
        nextChangeMs == null ? null : setTimeout(run, Math.max(0, nextChangeMs - now));
    };
    run();
  }, [setIfChanged]);

  useEffect(() => () => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
  }, []);

  const prevApiRef = useRef(api);
  useEffect(() => {
    if (prevApiRef.current === api) return;
    prevApiRef.current = api;
    sigRef.current = {};
    trackStartRef.current = null;
    setTrackStartedAt(null);
    offlinePollsRef.current = 0;
    lastTrackKeyRef.current = null;
    bufferMsRef.current = 0;
    leadMsRef.current = 0;
    setLeadMs(0);
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    rawSessionRef.current = EMPTY_SESSION;
    if (voiceTimerRef.current) {
      clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    setNowPlaying(null);
    setContext(null);
    setDj(null);
    setActiveShow(null);
    setListeners(null);
    setStreamOnline(null);
    setStreamInfo(null);
    setLlmTokens(null);
    setState(EMPTY_STATE);
    setSession(EMPTY_SESSION);
    setTimezone(null);
    setLocale(DEFAULT_STATION_LOCALE);
    setElapsed(0);
  }, [api]);

  // The idle skip moved this listener nearer the live edge (#9): the lag is
  // the advertised buffer less the trim, and the track clock shifts with it.
  useEffect(() => {
    if (leadTrimMs === trimMsRef.current) return;
    trimMsRef.current = leadTrimMs;
    const next = Math.max(0, bufferMsRef.current - leadTrimMs);
    const delta = next - leadMsRef.current;
    leadMsRef.current = next;
    setLeadMs(next);
    if (trackStartRef.current != null) {
      trackStartRef.current += delta;
      setTrackStartedAt(trackStartRef.current);
      setElapsed(trackElapsedSeconds(trackStartRef.current));
    }
    applySession();
  }, [leadTrimMs, applySession]);

  useEffect(() => {
    if (!api) return;
    const background = !appActive;
    if (background && !backgroundPoll) return;

    const applyNowPlaying = (npRes: NowPlayingResponse, current?: StationState['current']) => {
      const np = npRes.nowPlaying;
      const bufSec = npRes.stream?.bufferSeconds;
      if (typeof bufSec === 'number' && Number.isFinite(bufSec)) {
        bufferMsRef.current = Math.min(Math.max(bufSec, 0), MAX_LEAD_SECONDS) * 1000;
        leadMsRef.current = Math.max(0, bufferMsRef.current - trimMsRef.current);
        setLeadMs(leadMsRef.current);
      }
      const trackKey = np ? `${np.title}\0${np.artist}` : null;

      let serverStart = NaN;
      if (np?.title && current && current.title === np.title && current.startedAt) {
        const t = Date.parse(current.startedAt);
        if (Number.isFinite(t) && t <= Date.now()) serverStart = t;
      }
      const audibleAt = Number.isFinite(serverStart) ? serverStart + leadMsRef.current : Date.now();

      if (trackKey !== lastTrackKeyRef.current) {
        const commit = () => {
          promoteTimerRef.current = null;
          lastTrackKeyRef.current = trackKey;
          trackStartRef.current = audibleAt;
          setTrackStartedAt(audibleAt);
          setIfChanged('nowPlaying', np, setNowPlaying);
        };
        const wait = audibleAt - Date.now();
        if (promoteTimerRef.current) clearTimeout(promoteTimerRef.current);
        if (wait <= 0 || trackKey == null || lastTrackKeyRef.current == null) commit();
        else promoteTimerRef.current = setTimeout(commit, wait);
      } else {
        if (Number.isFinite(serverStart)) {
          const prev = trackStartRef.current;
          if (prev == null || Math.abs(audibleAt - prev) > 2500) {
            trackStartRef.current = audibleAt;
            setTrackStartedAt(audibleAt);
          }
        }
        setIfChanged('nowPlaying', np, setNowPlaying);
      }
      setIfChanged('context', npRes.context, setContext);
      if (npRes.dj) setIfChanged('dj', npRes.dj, setDj);
      setIfChanged('activeShow', npRes.activeShow ?? npRes.context?.activeShow ?? null, setActiveShow);
      if (npRes.listeners != null) setIfChanged('listeners', npRes.listeners, setListeners);
      if (typeof npRes.streamOnline === 'boolean') {
        if (npRes.streamOnline) {
          offlinePollsRef.current = 0;
          setStreamOnline(true);
        } else {
          offlinePollsRef.current += 1;
          if (offlinePollsRef.current >= OFFLINE_CONFIRM_POLLS) setStreamOnline(false);
        }
      }
      if (npRes.stream) setIfChanged('streamInfo', npRes.stream, setStreamInfo);
      if (typeof npRes.llmTokens === 'number') setIfChanged('llmTokens', npRes.llmTokens, setLlmTokens);
      if (typeof npRes.timezone === 'string' && npRes.timezone) setTimezone(npRes.timezone);
      if (npRes.locale === 'en-US' || npRes.locale === 'en-GB') setLocale(npRes.locale);
    };

    const applySessionPayload = (se: PromiseSettledResult<SessionPayload>) => {
      if (se.status === 'fulfilled' && se.value && Array.isArray(se.value.messages)) {
        rawSessionRef.current = se.value;
        applySession();
      }
    };

    const tick = async (signal: AbortSignal) => {
      if (background) {
        const [np, se] = await Promise.allSettled([api.nowPlaying(signal), api.session(signal)]);
        if (signal.aborted) return;
        if (np.status === 'fulfilled') applyNowPlaying(np.value);
        applySessionPayload(se);
        return;
      }
      const [np, st, se] = await Promise.allSettled([
        api.nowPlaying(signal),
        api.state(signal),
        api.session(signal),
      ]);
      if (signal.aborted) return;
      if (np.status === 'fulfilled') {
        applyNowPlaying(np.value, st.status === 'fulfilled' ? st.value?.current : undefined);
      }
      if (st.status === 'fulfilled') setIfChanged('state', feedState(st.value), setState);
      applySessionPayload(se);
    };
    const stopPolling = pollAsync(tick, background ? 30000 : 5000);
    return () => {
      stopPolling();
      if (promoteTimerRef.current) {
        clearTimeout(promoteTimerRef.current);
        promoteTimerRef.current = null;
      }
    };
    // leadTrimMs restarts the poll, so a held track switch is re-derived at once.
  }, [api, appActive, backgroundPoll, setIfChanged, applySession, leadTrimMs]);

  useEffect(() => {
    if (!appActive) return;
    const update = () => {
      if (trackStartRef.current) {
        setElapsed(trackElapsedSeconds(trackStartRef.current));
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [appActive]);

  const duration = nowPlaying?.duration ?? 0;
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return {
    nowPlaying,
    context,
    dj,
    activeShow,
    listeners,
    streamOnline,
    streamInfo,
    llmTokens,
    state,
    session,
    leadMs,
    elapsed,
    progress,
    trackStartedAt,
    timezone,
    locale,
  };
}
