import { useEffect, useRef, useState } from 'react';
import TrackPlayer, { Event, useTrackPlayerEvents } from 'react-native-track-player';
import { useAppActive } from '@/hooks/useAppActive';
import { useTalking } from '@/hooks/useTalking';
import type { PlayerStatus } from '@/hooks/usePlayer';
import { resolveAirCard } from '@/lib/air-card';
import type { StationApi } from '@/lib/api';
import { cardArtwork, hasPlayed, sendsCard, type SentCard } from '@/lib/now-playing-card';
import type { ActiveShow, NowPlayingTrack, SessionTurn } from '@/lib/types';
import { nowPlayingProgress } from '@/lib/track-progress';

export interface UseNowPlayingInfoParams {
  api: StationApi | null;
  tunedIn: boolean;
  status: PlayerStatus;
  nowPlaying: NowPlayingTrack | null;
  boothFeed?: SessionTurn[];
  leadMs: number;
  trackStartedAt: number | null;
  activeShow?: ActiveShow | null;
}

export function useNowPlayingInfo({
  api,
  tunedIn,
  status,
  nowPlaying,
  boothFeed,
  leadMs,
  trackStartedAt,
  activeShow,
}: UseNowPlayingInfoParams): void {
  const talking = useTalking(boothFeed, leadMs);
  const appActive = useAppActive();
  const card = api ? resolveAirCard({ api, nowPlaying, activeShow, talking }) : null;

  const title = card?.title;
  const artist = card?.artist;
  const album = card?.album;
  const artwork = card?.artworkUrl;
  const duration = nowPlaying?.duration;

  // A loaded item resets the native card.
  const [item, setItem] = useState(0);
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], () => setItem((n) => n + 1));
  const sentRef = useRef<SentCard | null>(null);

  useEffect(() => {
    if (!api || !tunedIn || !title) {
      sentRef.current = null;
      return;
    }
    const last = sentRef.current;
    const played = hasPlayed(last, item, status === 'playing');
    const next: SentCard = { title, artist, album, artwork, item, played };
    const withCard = sendsCard(last, next);
    sentRef.current = next;
    const update = (includeCard: boolean) => {
      TrackPlayer.updateNowPlayingMetadata({
        ...(includeCard ? { title, artist, album, artwork: cardArtwork(next) } : {}),
        // Retain iOS's LIVE presentation and the absence of seek controls.
        isLiveStream: true,
        ...nowPlayingProgress({ track: { duration }, trackStartedAt, talking }),
      }).catch(() => {
        /* no active track yet */
      });
    };
    update(withCard);
    // Native playback state extrapolates between updates.
    const timer = setInterval(() => update(false), 30000);
    return () => clearInterval(timer);
  }, [api, tunedIn, status, title, artist, album, artwork, duration, trackStartedAt, talking, appActive, item]);
}
