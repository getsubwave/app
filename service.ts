// This headless service cannot access React state.
// Skip and seek are unavailable on a shared live broadcast.
import TrackPlayer, { Event } from 'react-native-track-player';
import { clearCarError, showCarError } from './modules/android-auto';
import { getLastLiveMeta, loadAndPlay } from '@/audio/player';
import { plog } from '@/hooks/usePlayer';
import { createCarPicks } from '@/intents/car-picks';
import { activeStationLocked, tuneIn, tuneInByName } from '@/intents/tune';
import { remotePlay } from '@/lib/remote-play';

// The RNTP patch adds playWhenReady to these; 4.1.2's types lack it.
interface CarPickFlag {
  playWhenReady?: boolean;
}

export async function PlaybackService(): Promise<void> {
  // A failed pick shows the car why (src/intents/car-errors.ts).
  const carPicks = createCarPicks(plog, Date.now, {
    show: ({ kind, message }) => showCarError(kind, message),
    clear: clearCarError,
    locked: activeStationLocked,
  });

  // RemotePlay reloads with a cache-buster to discard the paused buffer,
  // through the app's player and its stream recovery while that is mounted
  // (src/lib/remote-play.ts), where a failed load goes to the error backoff.
  // If a direct load fails, fall back to play.
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    // A station the car only prepared plays now (src/intents/car-picks.ts).
    if (carPicks.playPrepared()) return;
    return remotePlay({
      hasStream: () => getLastLiveMeta() !== null,
      reloadLast: async () => {
        const meta = getLastLiveMeta();
        if (meta) await loadAndPlay(meta);
      },
      resume: () => TrackPlayer.play(),
    });
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    carPicks.forget();
    return TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    carPicks.forget();
    return TrackPlayer.stop();
  });

  // Android Auto: a station picked from the car's list (its id is the
  // station's base), or asked for by voice. The tune-in Siri uses, so with the
  // player mounted it is handed to it (tune-flow.ts); a failure goes to the
  // playback log.
  TrackPlayer.addEventListener(Event.RemotePlayId, (e) => {
    const { id } = e;
    const { playWhenReady = true } = e as CarPickFlag;
    void carPicks.pick(
      { label: `pick ${id}`, tune: (deadline) => tuneIn(id, deadline) },
      playWhenReady,
    );
  });
  TrackPlayer.addEventListener(Event.RemotePlaySearch, (e) => {
    const { query } = e;
    const { playWhenReady = true } = e as CarPickFlag;
    void carPicks.pick(
      {
        label: `search "${query}"`,
        tune: (deadline) => tuneInByName(query, deadline),
      },
      playWhenReady,
    );
  });

  // Never settle. On Android this is a headless JS task, and RN fires JS timers
  // behind a paused activity only while one is running — the feed poll that
  // keeps lock-screen and Bluetooth metadata current among them. RN 0.85 never
  // delivered the finish signal; 0.86 does, so returning here stopped every
  // timer the moment the screen locked.
  await new Promise<never>(() => {});
}
