import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus } from '@/hooks/usePlayer';
import type { HealthResult, StationApi } from '@/lib/api';
import { loginRefused } from '@/lib/station-login';
import { watchStuckLogin } from '@/lib/stuck-login-check';

const PROBE_TIMEOUT_MS = 4_500;

export interface LoginCheckState {
  rejected: boolean;
  recheck: () => Promise<void>;
}

export function useLoginCheck({
  api,
  hasLogin,
  tunedIn,
  status,
  stop,
}: {
  api: StationApi | null;
  hasLogin: boolean;
  tunedIn: boolean;
  status: PlayerStatus;
  stop: () => void;
}): LoginCheckState {
  const [rejected, setRejected] = useState(false);
  const lastCheckRef = useRef(0);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const probe = useCallback(async (a: StationApi): Promise<HealthResult> => {
    lastCheckRef.current = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      return await a.probeHealth(ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    setRejected(false);
    if (!api || !hasLogin) return;
    let alive = true;
    void probe(api).then((result) => {
      if (alive) setRejected(loginRefused(result));
    });
    return () => {
      alive = false;
    };
  }, [api, hasLogin, probe]);

  useEffect(() => {
    if (!api || !hasLogin || rejected || !tunedIn || status !== 'connecting') return;
    return watchStuckLogin({
      probe: () => probe(api),
      lastCheckAt: () => lastCheckRef.current,
      current: () => apiRef.current === api,
      onRefused: () => setRejected(true),
    });
  }, [api, hasLogin, rejected, tunedIn, status, probe]);

  useEffect(() => {
    if (rejected && tunedIn) stop();
  }, [rejected, tunedIn, stop]);

  const recheck = useCallback(async () => {
    const a = apiRef.current;
    if (!a) return;
    const result = await probe(a);
    if (apiRef.current === a && result.ok) setRejected(false);
  }, [probe]);

  return { rejected, recheck };
}
