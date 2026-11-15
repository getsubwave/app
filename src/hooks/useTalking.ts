import { useEffect, useState } from 'react';
import { talkingState } from '@/lib/voice-turn';
import type { SessionTurn } from '@/lib/types';

export function useTalking(boothFeed: SessionTurn[] | undefined, leadMs: number): boolean {
  const [talking, setTalking] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      const now = Date.now();
      const { talking: next, nextChangeMs } = talkingState(boothFeed, leadMs, now);
      setTalking(next);
      timer = nextChangeMs == null ? null : setTimeout(apply, Math.max(0, nextChangeMs - now));
    };
    apply();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [boothFeed, leadMs]);

  return talking;
}
