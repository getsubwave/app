import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import TrackPlayer, {
  Event,
  State,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import {
  addAudioRouteChangeListener,
  ROUTE_REASON_OLD_DEVICE_UNAVAILABLE,
} from '../../modules/airplay-route-picker';
import { setOnAir } from '../../modules/app-intents';
import {
  getLastLiveMeta,
  loadAndPlay,
  onExternalTuneOut,
  setupPlayer,
  teardown,
} from '@/audio/player';
import type { StationApi } from '@/lib/api';
import { SKIP_CUSHION_SECONDS } from '@/lib/idle-skip';
import { IdleSkip } from '@/lib/idle-skip-playback';
import { playbackEventLine, playbackLog } from '@/lib/playback-log';
import { claimRemotePlay } from '@/lib/remote-play';
import { MAX_LEAD_SECONDS } from '@/lib/sessionFeed';
import { streamBelongsTo } from '@/lib/station-store';
import { StreamRecovery } from '@/lib/stream-recovery';
import type { StreamFormat } from '@/lib/streamFormat';
import { loadVolumePref, saveVolumePref } from '@/lib/volume';

function plog(msg: string) {
  playbackLog.add(msg);
  if (__DEV__) console.log(`[player ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export type PlayerStatus = 'idle' | 'connecting' | 'playing';

export interface Player {
  tunedIn: boolean;
  status: PlayerStatus;
  volume: number;
  setVolume: (v: number) => void;
  tune: () => void;
  stop: () => void;
  toggleMute: () => void;
  muted: boolean;
}

export interface IdleSkipOptions {
  /** The station's advertised stream.bufferSeconds. */
  bufferSeconds?: number | null;
  /** Lag the idle skip shed from this connection, in ms; 0 on each new one. */
  onLeadTrim?: (ms: number) => void;
}

export function usePlayer(
  api: StationApi | null,
  initialVolume = 1,
  isConnected: boolean | null = null,
  streamFormat: StreamFormat = 'mp3',
  idle: IdleSkipOptions = {},
): Player {
  const [tunedIn, setTunedIn] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [volume, setVolumeState] = useState(initialVolume);
  const preMuteVolume = useRef(initialVolume || 1);

  const tunedInRef = useRef(tunedIn);
  const apiRef = useRef(api);
  const formatRef = useRef(streamFormat);
  const volumeRef = useRef(volume);
  useEffect(() => { tunedInRef.current = tunedIn; }, [tunedIn]);
  useEffect(() => { apiRef.current = api; }, [api]);
  useEffect(() => { formatRef.current = streamFormat; }, [streamFormat]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const bufferSecondsRef = useRef(idle.bufferSeconds);
  const onLeadTrimRef = useRef(idle.onLeadTrim);
  useEffect(() => { bufferSecondsRef.current = idle.bufferSeconds; }, [idle.bufferSeconds]);
  useEffect(() => { onLeadTrimRef.current = idle.onLeadTrim; }, [idle.onLeadTrim]);
  const idleSkipRef = useRef<IdleSkip | null>(null);
  const endIdleSkip = useCallback(() => {
    idleSkipRef.current?.cancel();
    idleSkipRef.current = null;
    onLeadTrimRef.current?.(0);
  }, []);
  // MP3 only: its burst is CBR, so bufferSeconds sizes it. An older broadcast
  // image's Opus burst is VBR and reaches back past the pause into music.
  const startIdleSkip = useCallback((a: StationApi): IdleSkip | null => {
    endIdleSkip();
    const buffer = bufferSecondsRef.current;
    if (formatRef.current !== 'mp3' || AppState.currentState !== 'active') return null;
    if (typeof buffer !== 'number' || !(buffer > SKIP_CUSHION_SECONDS)) return null;
    const skip = new IdleSkip({
      bufferSeconds: Math.min(buffer, MAX_LEAD_SECONDS),
      readState: (signal) => a.state(signal),
      position: () => TrackPlayer.getProgress().then((p) => p.position),
      setRate: (rate) => TrackPlayer.setRate(rate),
      onTrim: (ms) => onLeadTrimRef.current?.(ms),
      log: plog,
    });
    idleSkipRef.current = skip;
    return skip;
  }, [endIdleSkip]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') idleSkipRef.current?.background();
    });
    return () => {
      sub.remove();
      idleSkipRef.current?.cancel();
      idleSkipRef.current = null;
    };
  }, []);

  const recoveryRef = useRef<StreamRecovery | null>(null);
  useEffect(() => {
    const recovery = new StreamRecovery({
      position: () => TrackPlayer.getProgress().then((p) => p.position),
      reload: async () => {
        const a = apiRef.current;
        if (!a) return;
        setStatus('connecting');
        const skip = startIdleSkip(a);
        try {
          await loadAndPlay({ url: a.streamUrl(formatRef.current), headers: a.streamHeaders() });
        } catch (e) {
          skip?.cancel();
          throw e;
        }
        if (skip) {
          skip.loaded();
          // Its first Playing can land before load and play resolve.
          TrackPlayer.getPlaybackState().then((p) => skip.onState(p.state)).catch(() => {});
        }
        await TrackPlayer.setVolume(volumeRef.current);
      },
      onAdvancing: () => setStatus('playing'),
      log: plog,
    });
    recoveryRef.current = recovery;
    return () => {
      recovery.tuneOut();
      recoveryRef.current = null;
    };
  }, [startIdleSkip]);

  useEffect(() => claimRemotePlay(() => {
    const recovery = recoveryRef.current;
    if (!apiRef.current || !recovery) return false;
    tunedInRef.current = true;
    setTunedIn(true);
    setStatus('connecting');
    recovery.tuneIn('remote');
    return true;
  }), []);

  useEffect(() => { setupPlayer().catch(() => {}); }, []);

  useEffect(() => {
    TrackPlayer.setVolume(volume).catch(() => {});
  }, [volume]);

  const hydratedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    loadVolumePref().then((stored) => {
      if (!alive) return;
      if (stored !== null) {
        setVolumeState(stored);
        if (stored > 0) preMuteVolume.current = stored;
      }
      hydratedRef.current = true;
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const id = setTimeout(() => { void saveVolumePref(volume); }, 300);
    return () => clearTimeout(id);
  }, [volume]);

  // RemotePause/RemoteStop are handled here as well as in
  // service.ts: the Stopped/Ended state a lock-screen pause produces is
  // indistinguishable from a stream failure, so without this the error
  // backoff reconnects 500ms later.
  useTrackPlayerEvents(
    [Event.PlaybackState, Event.PlaybackError, Event.RemotePause, Event.RemoteStop, Event.RemoteDuck],
    (event) => {
      plog(playbackEventLine(event));
      if (event.type === Event.RemotePause || event.type === Event.RemoteStop) {
        recoveryRef.current?.tuneOut();
        endIdleSkip();
        tunedInRef.current = false;
        setTunedIn(false);
        setStatus('idle');
        return;
      }
      if (event.type === Event.RemoteDuck) {
        if (event.paused) idleSkipRef.current?.background();
        recoveryRef.current?.onDuck(event.paused, event.permanent);
        return;
      }
      if (event.type === Event.PlaybackError) {
        idleSkipRef.current?.onState('error');
        if (tunedInRef.current) setStatus('connecting');
        recoveryRef.current?.onError();
        return;
      }
      const state = event.state;
      idleSkipRef.current?.onState(state);
      if (state === State.Playing) {
        setStatus('playing');
        if (!tunedInRef.current && getLastLiveMeta()) {
          tunedInRef.current = true;
          setTunedIn(true);
          recoveryRef.current?.adopt();
        }
      } else if (state === State.Buffering || state === State.Loading) {
        setStatus((s) => (s === 'playing' ? 'connecting' : s));
      } else if (state === State.Ended || state === State.Stopped || state === State.Error) {
        if (tunedInRef.current) setStatus((s) => (s === 'playing' ? 'connecting' : s));
      }
      recoveryRef.current?.onState(state);
    },
  );

  // A tune-in that started before this hook mounted: an App Intent can launch
  // the app into the background and start the stream (src/intents/tune.ts)
  // while the screens are still loading, so the Playing event that would
  // adopt it has already fired.
  useEffect(() => {
    let alive = true;
    TrackPlayer.getPlaybackState()
      .then(({ state }) => {
        if (!alive || tunedInRef.current || !getLastLiveMeta()) return;
        if (state !== State.Playing && state !== State.Buffering && state !== State.Loading) {
          return;
        }
        tunedInRef.current = true;
        setTunedIn(true);
        setStatus(state === State.Playing ? 'playing' : 'connecting');
        recoveryRef.current?.adopt();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The tune control (targets/live-activity/TuneControl.swift) cannot ask the
  // player, so it shows this. Written on mount too, which clears a flag an
  // app killed mid-song left on.
  useEffect(() => {
    setOnAir(tunedIn);
  }, [tunedIn]);

  // An App Intent tune-out (src/intents/tune.ts): the same synchronous ref
  // flip as the RemotePause handler above, ahead of the Stopped event.
  useEffect(
    () =>
      onExternalTuneOut(() => {
        recoveryRef.current?.tuneOut();
        endIdleSkip();
        tunedInRef.current = false;
        setTunedIn(false);
        setStatus('idle');
      }),
    [endIdleSkip],
  );

  // iOS: an oldDeviceUnavailable route change (Bluetooth speaker off, CarPlay
  // disconnected, headphones unplugged) is a tune-out (#992) — the
  // longFormAudio session policy keeps AVPlayer "playing" to the vanished
  // route, holding the Icecast socket open as a phantom listener. Every other
  // reason must keep playing: newDeviceAvailable / override /
  // routeConfigurationChange are the AirPlay/HomePod handoffs.
  useEffect(() => {
    const sub = addAudioRouteChangeListener((e) => {
      plog(`route change reason=${e.reason} outputs=${e.outputs}`);
      if (e.reason !== ROUTE_REASON_OLD_DEVICE_UNAVAILABLE || !tunedInRef.current) return;
      recoveryRef.current?.tuneOut();
      endIdleSkip();
      tunedInRef.current = false;
      setTunedIn(false);
      setStatus('idle');
      // stop(), not pause: unloads the item so the Icecast connection drops.
      TrackPlayer.stop().catch(() => {});
    });
    return () => sub?.remove();
  }, [endIdleSkip]);

  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    const prev = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (prev === false && isConnected === true && tunedInRef.current && status !== 'playing') {
      recoveryRef.current?.linkRegained();
    }
  }, [isConnected, status]);

  const stop = useCallback(() => {
    recoveryRef.current?.tuneOut();
    endIdleSkip();
    setTunedIn(false);
    setStatus('idle');
    teardown().catch(() => {});
  }, [endIdleSkip]);

  // On a station switch selectStation has already torn the stream down at the
  // RNTP level; drop local tuned-in state so the UI doesn't claim "on air"
  // over dead audio. (The event handler ignores State.None because reset()
  // also fires it mid tune-in and mid reconnect.)
  // One exception: a switch from Siri, Shortcuts or Spotlight
  // (src/intents/tune.ts) starts the new station's stream before the base
  // changes here. A stream that already belongs to the new base is kept.
  const prevBaseRef = useRef(api?.base ?? null);
  useEffect(() => {
    const nextBase = api?.base ?? null;
    if (prevBaseRef.current === nextBase) return;
    prevBaseRef.current = nextBase;
    const meta = getLastLiveMeta();
    const adopted = !!(nextBase && meta && streamBelongsTo(meta.url, nextBase));
    if (tunedInRef.current && !adopted) stop();
  }, [api, stop]);

  const prevFormatRef = useRef(streamFormat);
  useEffect(() => {
    if (prevFormatRef.current === streamFormat) return;
    prevFormatRef.current = streamFormat;
    if (!tunedInRef.current) return;
    recoveryRef.current?.retune();
  }, [streamFormat]);

  const tune = useCallback(() => {
    if (tunedInRef.current) {
      stop();
      return;
    }
    if (!apiRef.current) return;
    setTunedIn(true);
    setStatus('connecting');
    recoveryRef.current?.tuneIn();
  }, [stop]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  const toggleMute = useCallback(() => {
    setVolumeState((v) => {
      if (v > 0) {
        preMuteVolume.current = v;
        return 0;
      }
      return preMuteVolume.current || 1;
    });
  }, []);

  return {
    tunedIn,
    status,
    volume,
    setVolume,
    tune,
    stop,
    toggleMute,
    muted: volume === 0,
  };
}
