// "What's playing on SUB/WAVE" and "like this song on SUB/WAVE". Both mean the
// track the listener is hearing: the live edge, or, while this app is playing,
// the previous track for the stream buffer's length after a change
// (heardTrack, the rule useStationFeed promotes tracks by).

import type { IntentReply } from '../../modules/app-intents';
import { isOnAir, playbackStateNow } from '@/audio/player';
import { heardTrack, leadMsFrom, leadTrimMs, listenerLeadMs } from '@/lib/heard-track';
import { announceLike } from '@/lib/like-events';
import type { StationApi } from '@/lib/api';
import {
  likeReply,
  likeTarget,
  whatsPlayingReply,
  type OnAirSnapshot,
  type OnAirTrack,
} from './on-air-reply';
import type { IntentStation } from './station';

async function snapshot(api: StationApi): Promise<OnAirSnapshot> {
  const [npRes, stateRes] = await Promise.allSettled([api.nowPlaying(), api.state()]);
  if (npRes.status !== 'fulfilled') return { reachable: false, online: false, track: null };
  const np = npRes.value;
  const live: OnAirTrack | null = np.nowPlaying;
  const online = np.streamOnline !== false;
  if (!isOnAir(await playbackStateNow()) || stateRes.status !== 'fulfilled') {
    return { reachable: true, online, track: live };
  }
  // The same pairing useStationFeed makes: /state's live-edge stamp only
  // counts when it is for the track /now-playing names.
  const current = stateRes.value.current;
  const stamp = live?.title && current?.title === live.title && current.startedAt
    ? Date.parse(current.startedAt)
    : NaN;
  const track = heardTrack<OnAirTrack>({
    live,
    previous: stateRes.value.history?.[0] ?? null,
    liveStartMs: Number.isFinite(stamp) ? stamp : null,
    leadMs: listenerLeadMs(leadMsFrom(np.stream?.bufferSeconds) ?? 0, leadTrimMs()),
    now: Date.now(),
  });
  return { reachable: true, online, track };
}

function stationName(station: IntentStation): string {
  return station.name || 'SUB/WAVE';
}

export async function whatsPlaying(station: IntentStation): Promise<IntentReply> {
  return whatsPlayingReply(stationName(station), await snapshot(station.api));
}

export async function likeHeardTrack(station: IntentStation): Promise<IntentReply> {
  const name = stationName(station);
  const snap = await snapshot(station.api);
  const target = likeTarget(name, snap);
  if (!('songId' in target)) return target;
  const result = await station.api.likeCurrent(target.songId);
  if (result && !result.error && (result.ok || result.alreadyLiked)) {
    announceLike({ songId: target.songId, count: result.count });
  }
  return likeReply(name, snap.track ?? {}, result);
}
