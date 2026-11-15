import type { StationApi } from './api';
import type { ActiveShow, NowPlayingTrack } from './types';

export interface AirCard {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | undefined;
  artworkKey: string | null;
  show: string | null;
  showingPersona: boolean;
}

export function resolveAirCard(params: {
  api: StationApi;
  nowPlaying: NowPlayingTrack | null | undefined;
  activeShow: ActiveShow | null | undefined;
  talking: boolean;
}): AirCard {
  const { api, nowPlaying, activeShow, talking } = params;
  const personaName = activeShow?.persona?.name ?? null;
  const personaAvatar = activeShow?.persona?.avatar ?? null;

  const coverUrl = nowPlaying?.subsonic_id ? api.cover(nowPlaying.subsonic_id) : undefined;
  const avatarUrl = personaAvatar ? api.avatar(personaAvatar) : undefined;
  const showingPersona = talking && !!avatarUrl;

  return {
    title: nowPlaying?.title || 'SUB/WAVE',
    artist: showingPersona
      ? personaName || nowPlaying?.artist || 'Live broadcast'
      : nowPlaying?.artist || 'Live broadcast',
    album: nowPlaying?.album || 'SUB/WAVE',
    artworkUrl: showingPersona ? avatarUrl : coverUrl,
    artworkKey: showingPersona ? personaAvatar : nowPlaying?.subsonic_id ?? null,
    show: activeShow?.name ?? null,
    showingPersona,
  };
}
