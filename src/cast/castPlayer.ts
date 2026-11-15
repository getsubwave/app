// Updating Default Receiver metadata requires a reload and causes an audible gap.

import { MediaStreamType, type RemoteMediaClient } from 'react-native-google-cast';

export interface CastStreamMeta {
  url: string;
  stationName?: string;
  djName?: string;
  artworkUrl?: string | null;
}

export async function loadLiveStream(
  client: RemoteMediaClient,
  meta: CastStreamMeta,
): Promise<void> {
  await client.loadMedia({
    autoplay: true,
    mediaInfo: {
      contentUrl: meta.url,
      contentType: 'audio/mpeg',
      streamType: MediaStreamType.LIVE,
      metadata: {
        type: 'musicTrack',
        title: meta.stationName || 'SUB/WAVE',
        artist: meta.djName ? `${meta.djName} · live broadcast` : 'Live broadcast',
        images: meta.artworkUrl ? [{ url: meta.artworkUrl }] : undefined,
      },
    },
  });
}
