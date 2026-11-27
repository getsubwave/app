import { Platform } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  type PlayerOptions,
  RatingType,
  State,
} from 'react-native-track-player';
import { createAnnouncer } from '@/lib/announcer';
import { setLeadTrimMs } from '@/lib/heard-track';
import { playbackLog } from '@/lib/playback-log';

const STREAM_TRACK_ID = 'subwave-live';

let setupPromise: Promise<void> | null = null;

export function setupPlayer(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      // RNTP reads iosCategoryPolicy natively but omits it from PlayerOptions.
      const options: PlayerOptions & { iosCategoryPolicy?: 'longFormAudio' } = {
        autoHandleInterruptions: true,
        // Android LoadControl needs deep buffering for dropouts (#993).
        // iOS maps minBuffer to preferredForwardBufferDuration; a nonzero value silences this stream.
        ...(Platform.OS === 'android'
          ? { minBuffer: 60, maxBuffer: 120, playBuffer: 2, backBuffer: 0 }
          : {}),
        // longFormAudio preserves the selected AirPlay route across audio-session changes.
        iosCategoryPolicy: 'longFormAudio',
      };
      await TrackPlayer.setupPlayer(options);
    } catch (e) {
      // "player already initialized" throws on fast refresh; benign.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already been initialized|already initialized/i.test(msg)) {
        setupPromise = null;
        throw e;
      }
    }
    await TrackPlayer.updateOptions({
      capabilities: [Capability.Play, Capability.Pause, Capability.Stop],
      compactCapabilities: [Capability.Play, Capability.Pause],
      notificationCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
      ratingType: RatingType.Heart,
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
    });
  })();
  return setupPromise;
}

export interface LiveTrackMeta {
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
  // Carries `Authorization: Basic …` for a station with basic auth. RNTP maps
  // these onto AVURLAsset and the Android DataSource; it is the only auth path
  // AVPlayer honours, since it ignores URL userinfo (#764).
  headers?: Record<string, string>;
}

let lastLiveMeta: LiveTrackMeta | null = null;

export function getLastLiveMeta(): LiveTrackMeta | null {
  return lastLiveMeta;
}

/** Use load() to preserve the iOS AirPlay route; reset()+add() deactivates
 *  the audio session. */
export async function loadAndPlay(meta: LiveTrackMeta): Promise<void> {
  await setupPlayer();
  // RNTP carries the rate over to the next item; an idle skip's 8x must never
  // reach a new connection's music (src/lib/idle-skip-playback.ts).
  await TrackPlayer.setRate(1).catch(() => {});
  // A new connection carries its whole buffer again.
  setLeadTrimMs(0);
  const bust = `${meta.url}${meta.url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  await TrackPlayer.load({
    id: STREAM_TRACK_ID,
    url: bust,
    title: meta.title || 'SUB/WAVE',
    artist: meta.artist || 'Live broadcast',
    album: meta.album || 'SUB/WAVE',
    artwork: meta.artwork,
    isLiveStream: true,
    headers: meta.headers,
  });
  lastLiveMeta = meta;
  await TrackPlayer.play();
}

// A tune-out that reaches the player from outside the React tree without an
// RNTP remote event: an App Intent (src/intents/tune.ts). usePlayer must hear
// it before the Stopped event lands, or it reads Stopped as a dead stream and
// reconnects, the same trap RemotePause is handled for.
const externalTuneOuts = createAnnouncer();

export const onExternalTuneOut = externalTuneOuts.subscribe;

/** stop(), not teardown(): the Icecast connection drops, and lastLiveMeta
 *  survives so the next tune-in resumes at the live edge. */
export async function externalTuneOut(): Promise<void> {
  externalTuneOuts.announce();
  await TrackPlayer.stop();
}

/** The native states that mean a stream is on its way to the listener or
 *  reaching them: what an App Intent's tune-in leaves alone, what usePlayer
 *  adopts at mount, and when "what's playing" measures from the buffer. */
const ON_AIR_STATES: ReadonlySet<State> = new Set([State.Playing, State.Buffering, State.Loading]);

export function isOnAir(state: State | null | undefined): boolean {
  return state != null && ON_AIR_STATES.has(state);
}

/** The native state, or None when the player isn't set up yet. */
export async function playbackStateNow(): Promise<State> {
  try {
    return (await TrackPlayer.getPlaybackState()).state;
  } catch {
    return State.None;
  }
}

export async function teardown(): Promise<void> {
  lastLiveMeta = null;
  try {
    await TrackPlayer.reset();
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== 'player_not_initialized') {
      playbackLog.add(`teardown reset failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
