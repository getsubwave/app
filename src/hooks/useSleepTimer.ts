import { useCallback, useEffect, useRef, useState } from 'react';

export interface SleepTimer {
  active: boolean;
  armedMinutes: number | null;
  remainingSec: number | null;
  start: (minutes: number) => void;
  cancel: () => void;
}

export function useSleepTimer(onExpire: () => void): SleepTimer {
  const [armed, setArmed] = useState<{ endsAt: number; minutes: number } | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    if (armed == null) {
      setRemainingSec(null);
      return;
    }
    const tick = () => {
      const left = Math.ceil((armed.endsAt - Date.now()) / 1000);
      if (left <= 0) {
        setArmed(null);
        setRemainingSec(null);
        onExpireRef.current();
        return;
      }
      setRemainingSec(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [armed]);

  const start = useCallback((minutes: number) => {
    setArmed({ endsAt: Date.now() + minutes * 60_000, minutes });
  }, []);
  const cancel = useCallback(() => setArmed(null), []);

  return {
    active: armed != null,
    armedMinutes: armed?.minutes ?? null,
    remainingSec,
    start,
    cancel,
  };
}
