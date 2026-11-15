import { useCallback, useEffect, useState } from 'react';
import type { StationApi } from '@/lib/api';

export interface TrackLike {
  available: boolean;
  liked: boolean;
  count: number;
  pending: boolean;
  like: () => Promise<void>;
}

export function useTrackLike(api: StationApi | null, songId: string | null): TrackLike {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<{ songId: string | null; liked: boolean; count: number }>({
    songId: null,
    liked: false,
    count: 0,
  });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ songId, liked: false, count: 0 });
    if (!api || !songId) return;
    api.likeStatus().then((st) => {
      if (cancelled || !st) return;
      setEnabled(st.enabled !== false);
      if (st.songId && st.songId !== songId) return;
      setState({ songId, liked: !!st.liked, count: st.count ?? 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [api, songId]);

  const like = useCallback(async () => {
    if (!api || !songId || pending || (state.liked && state.songId === songId)) return;
    setPending(true);
    try {
      const res = await api.likeCurrent(songId);
      if (res && (res.ok || res.alreadyLiked)) {
        setState({ songId, liked: true, count: res.count ?? 0 });
      }
    } finally {
      setPending(false);
    }
  }, [api, songId, pending, state.liked, state.songId]);

  return {
    available: enabled && !!songId,
    liked: state.liked && state.songId === songId,
    count: state.songId === songId ? state.count : 0,
    pending,
    like,
  };
}
