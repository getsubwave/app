// A like made away from the heart: "like this song" from Siri
// (src/intents/on-air.ts). useTrackLike listens, so the heart and the Live
// Activity it drives fill now instead of on the next song's status fetch.

import { createAnnouncer } from './announcer';

export interface ExternalLike {
  songId: string;
  /** Likes for the song, all airings, when the station said. */
  count?: number;
}

const likes = createAnnouncer<ExternalLike>();

export const onExternalLike = likes.subscribe;
export const announceLike = likes.announce;
