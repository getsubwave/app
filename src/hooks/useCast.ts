// Cast fetches the URL itself and cannot send our Authorization header.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MediaPlayerState,
  useCastDevice,
  useCastSession,
  useCastState,
  useMediaStatus,
  useRemoteMediaClient,
  type RemoteMediaClient,
} from 'react-native-google-cast';
import { loadLiveStream } from '@/cast/castPlayer';
import type { Player, PlayerStatus } from '@/hooks/usePlayer';
import type { StationApi } from '@/lib/api';

export interface CastMeta {
  stationName?: string;
  djName?: string;
  artworkUrl?: string | null;
}

export interface CastInfo {
  /** Show the cast button? True when the station is castable (no basic-auth
   *  stream) and the Cast framework exists on this device (castState is null
   *  on Android without Play Services). */
  available: boolean;
  connected: boolean;
  deviceName: string | null;
}

export function useCast(
  api: StationApi | null,
  local: Player,
  meta: CastMeta,
): { player: Player; cast: CastInfo } {
  const castState = useCastState();
  const session = useCastSession();
  const client = useRemoteMediaClient();
  const device = useCastDevice();
  const mediaStatus = useMediaStatus();

  const castable = !!api && !api.streamHeaders();
  const connected = castable && !!session && !!client;

  const [castTunedIn, setCastTunedIn] = useState(false);
  const [castVolume, setCastVolume] = useState(1);
  const preMuteVolume = useRef(1);

  const castTunedInRef = useRef(castTunedIn);
  useEffect(() => { castTunedInRef.current = castTunedIn; }, [castTunedIn]);
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  const localRef = useRef(local);
  useEffect(() => { localRef.current = local; }, [local]);
  const metaRef = useRef(meta);
  useEffect(() => { metaRef.current = meta; }, [meta]);

  const loadToCast = useCallback(async (c: RemoteMediaClient) => {
    const a = apiRef.current;
    if (!a) return;
    setCastTunedIn(true);
    try {
      await loadLiveStream(c, { url: a.streamUrl(), ...metaRef.current });
    } catch {
      setCastTunedIn(false);
    }
  }, []);

  const prevClientRef = useRef<RemoteMediaClient | null>(null);
  useEffect(() => {
    const prev = prevClientRef.current;
    prevClientRef.current = client;
    if (!prev && client) {
      session?.getVolume().then((v) => {
        if (typeof v === 'number' && Number.isFinite(v)) {
          setCastVolume(Math.max(0, Math.min(1, v)));
        }
      }).catch(() => {});
      if (castable && localRef.current.tunedIn) {
        localRef.current.stop();
        void loadToCast(client);
      }
    } else if (prev && !client) {
      const wasTuned = castTunedInRef.current;
      setCastTunedIn(false);
      if (wasTuned) localRef.current.tune();
    }
  }, [client, castable, session, loadToCast]);

  useEffect(() => {
    if (!connected || castTunedInRef.current) return;
    const a = apiRef.current;
    if (!a) return;
    const url = mediaStatus?.mediaInfo?.contentUrl;
    const ps = mediaStatus?.playerState;
    if (
      url && url.startsWith(a.streamUrl()) &&
      (ps === MediaPlayerState.PLAYING || ps === MediaPlayerState.BUFFERING || ps === MediaPlayerState.LOADING)
    ) {
      setCastTunedIn(true);
    }
  }, [connected, mediaStatus]);

  // idleReason is undefined outside a terminal idle (e.g. while loading).
  useEffect(() => {
    if (!castTunedIn) return;
    if (mediaStatus?.playerState === MediaPlayerState.IDLE && mediaStatus.idleReason) {
      setCastTunedIn(false);
    }
  }, [mediaStatus, castTunedIn]);

  const prevBaseRef = useRef(api?.base ?? null);
  useEffect(() => {
    const next = api?.base ?? null;
    if (prevBaseRef.current === next) return;
    prevBaseRef.current = next;
    if (castTunedInRef.current) {
      client?.stop().catch(() => {});
      setCastTunedIn(false);
    }
  }, [api, client]);

  const castTune = useCallback(() => {
    if (castTunedInRef.current) {
      client?.stop().catch(() => {});
      setCastTunedIn(false);
      return;
    }
    if (client) void loadToCast(client);
  }, [client, loadToCast]);

  const castStop = useCallback(() => {
    client?.stop().catch(() => {});
    setCastTunedIn(false);
  }, [client]);

  const castSetVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setCastVolume(clamped);
      try {
        session?.setVolume(clamped);
      } catch {
        /* device may reject volume control (fixed-volume sinks) */
      }
    },
    [session],
  );

  const castToggleMute = useCallback(() => {
    setCastVolume((v) => {
      const next = v > 0 ? 0 : preMuteVolume.current || 1;
      if (v > 0) preMuteVolume.current = v;
      try {
        session?.setVolume(next);
      } catch {
        /* fixed-volume sink */
      }
      return next;
    });
  }, [session]);

  let castStatus: PlayerStatus = 'idle';
  if (castTunedIn) {
    const ps = mediaStatus?.playerState;
    castStatus =
      ps === MediaPlayerState.PLAYING || ps === MediaPlayerState.PAUSED
        ? 'playing'
        : 'connecting';
  }

  const player: Player = useMemo(
    () =>
      connected
        ? {
            tunedIn: castTunedIn || local.tunedIn,
            status: castStatus,
            volume: castVolume,
            setVolume: castSetVolume,
            tune: castTune,
            stop: castStop,
            toggleMute: castToggleMute,
            muted: castVolume === 0,
          }
        : local,
    [connected, castTunedIn, castStatus, castVolume, castSetVolume, castTune, castStop, castToggleMute, local],
  );

  return {
    player,
    cast: {
      available: castable && castState != null,
      connected,
      deviceName: connected ? device?.friendlyName ?? null : null,
    },
  };
}
