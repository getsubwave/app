import { useEffect, useRef, useState } from 'react';

export function useLingeringPresence(shown: boolean, holdMs: number): boolean {
  const [lingering, setLingering] = useState(false);
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown) {
      wasShown.current = true;
      return;
    }
    if (!wasShown.current) return;
    wasShown.current = false;
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), holdMs);
    return () => clearTimeout(timer);
  }, [shown, holdMs]);
  return shown || lingering;
}
