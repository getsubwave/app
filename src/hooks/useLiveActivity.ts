// ActivityKit rate-limits updates.

import { useEffect, useMemo, useRef } from 'react';
import {
  addLikePressedListener,
  isLiveActivitySupported,
  startLiveActivity,
  stopLiveActivity,
  updateLiveActivity,
  type LiveActivityState,
} from '../../modules/live-activity';
import { useTalking } from '@/hooks/useTalking';
import type { TrackLike } from '@/hooks/useTrackLike';
import { resolveAirCard } from '@/lib/air-card';
import type { StationApi } from '@/lib/api';
import type { ActiveShow, NowPlayingTrack, SessionTurn } from '@/lib/types';

export interface UseLiveActivityParams {
  api: StationApi | null;
  tunedIn: boolean;
  nowPlaying: NowPlayingTrack | null;
  activeShow?: ActiveShow | null;
  boothFeed?: SessionTurn[];
  leadMs: number;
  trackStartedAt: number | null;
  station: string;
  accent: string;
  like: TrackLike;
}

export function useLiveActivity({
  api,
  tunedIn,
  nowPlaying,
  activeShow,
  boothFeed,
  leadMs,
  trackStartedAt,
  station,
  accent,
  like,
}: UseLiveActivityParams): void {
  const supported = useMemo(() => isLiveActivitySupported(), []);

  const talking = useTalking(boothFeed, leadMs);
  const card = api ? resolveAirCard({ api, nowPlaying, activeShow, talking }) : null;

  // Native artwork fetch ignores URL userinfo.
  const artworkUrl = card?.artworkUrl;
  const artworkHeaders = useMemo(
    () => (api && artworkUrl ? api.imageHeaders(artworkUrl) : undefined) ?? {},
    [api, artworkUrl],
  );

  const state: LiveActivityState = useMemo(
    () => ({
      title: card?.title ?? 'SUB/WAVE',
      artist: card?.artist ?? 'Live broadcast',
      show: card?.show ?? null,
      artworkKey: card?.artworkKey ?? null,
      artworkUrl: card?.artworkUrl ?? null,
      artworkHeaders,
      startedAt: trackStartedAt,
      duration: nowPlaying?.duration ?? null,
      talking,
      likeCount: like.count,
      liked: like.liked,
      likeable: like.available,
    }),
    [
      card?.title,
      card?.artist,
      card?.show,
      card?.artworkKey,
      card?.artworkUrl,
      artworkHeaders,
      trackStartedAt,
      nowPlaying?.duration,
      talking,
      like.count,
      like.liked,
      like.available,
    ],
  );

  const stateRef = useRef(state);
  const startedRef = useRef(false);
  useEffect(() => {
    stateRef.current = state;
    if (!startedRef.current) return;
    void updateLiveActivity(state);
  }, [state]);

  // Accent is immutable in ActivityKit attributes.
  useEffect(() => {
    if (!supported || !api || !tunedIn) return;
    let cancelled = false;
    void (async () => {
      const ok = await startLiveActivity({ station, accent }, stateRef.current);
      if (!cancelled) startedRef.current = ok;
    })();
    return () => {
      cancelled = true;
      startedRef.current = false;
      void stopLiveActivity();
    };
  }, [supported, api, tunedIn, station, accent]);

  const likeRef = useRef(like);
  useEffect(() => {
    likeRef.current = like;
  }, [like]);

  useEffect(() => {
    if (!supported) return;
    const sub = addLikePressedListener(() => {
      void likeRef.current.like();
    });
    return () => sub?.remove();
  }, [supported]);
}
