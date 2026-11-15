import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus } from '@/hooks/usePlayer';
import type { StationApi } from '@/lib/api';
import { gateHolds, resumeOnAnswer } from '@/lib/gate-resume';
import {
  stationLockRequired,
  stationReadsOpen,
  verifyStoredPasswords,
  type GatePhase,
  type StationAuthResult,
  type StationPrivacy,
} from '@/lib/station-password';
import { watchStuckPassword } from '@/lib/stuck-password-check';

export type { GatePhase };

export interface StationGate {
  phase: GatePhase;
  readsOpen: boolean;
  solid: boolean;
  savedRejected: boolean;
  unlock: (password: string) => Promise<StationAuthResult>;
}

export function useStationGate({
  api,
  privacy,
  stationPassword,
  loginPassword,
  rememberStationPassword,
  forgetStationPassword,
  tunedIn,
  status,
  stop,
  tune,
}: {
  api: StationApi | null;
  privacy: StationPrivacy | null | undefined;
  stationPassword: string | null;
  loginPassword: string | null;
  rememberStationPassword: (password: string) => Promise<void>;
  forgetStationPassword: () => Promise<void>;
  tunedIn: boolean;
  status: PlayerStatus;
  stop: () => void;
  tune: () => void;
}): StationGate {
  const required = stationLockRequired(privacy);
  const solid = privacy?.privatePlayer === true;
  const listenerAuth = privacy?.listenerAuth === true;
  const [phase, setPhase] = useState<GatePhase>(required ? 'checking' : 'open');
  const [savedRejected, setSavedRejected] = useState(false);

  const passwordsRef = useRef({ stationPassword, loginPassword });
  useEffect(() => {
    passwordsRef.current = { stationPassword, loginPassword };
  }, [stationPassword, loginPassword]);
  const storeRef = useRef({ rememberStationPassword, forgetStationPassword });
  useEffect(() => {
    storeRef.current = { rememberStationPassword, forgetStationPassword };
  }, [rememberStationPassword, forgetStationPassword]);
  const playerRef = useRef({ tunedIn, tune });
  useEffect(() => {
    playerRef.current = { tunedIn, tune };
  }, [tunedIn, tune]);
  const lastCheckRef = useRef(0);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    if (!required || !api) {
      setPhase('open');
      return;
    }
    let alive = true;
    setPhase('checking');
    setSavedRejected(false);
    lastCheckRef.current = Date.now();
    void verifyStoredPasswords({
      stored: passwordsRef.current.stationPassword,
      login: passwordsRef.current.loginPassword,
      check: (pw) => api.checkStationAuth(pw),
    }).then(async (verdict) => {
      if (!alive) return;
      if (verdict.save) await storeRef.current.rememberStationPassword(verdict.save);
      else if (verdict.clearStored) await storeRef.current.forgetStationPassword();
      if (alive) {
        setSavedRejected(verdict.clearStored);
        setPhase(verdict.phase);
      }
    });
    return () => {
      alive = false;
    };
  }, [required, api]);

  useEffect(() => {
    if (required && !stationPassword) setPhase((p) => (p === 'ok' ? 'prompt' : p));
  }, [required, stationPassword]);

  const heldForRef = useRef<StationApi | null>(null);
  useEffect(() => {
    const held = gateHolds(heldForRef.current === api, { required, takesAudio: false, phase, tunedIn });
    heldForRef.current = held ? api : null;
    if (phase === 'prompt' && tunedIn) stop();
  }, [required, phase, tunedIn, stop, api]);

  // Icecast rejects a stale password silently, as far as the player can tell:
  // it just keeps reconnecting.
  useEffect(() => {
    if (!listenerAuth || phase !== 'ok' || !tunedIn || status !== 'connecting' || !api) return;
    let alive = true;
    const cancel = watchStuckPassword({
      check: async () => {
        const password = passwordsRef.current.stationPassword;
        if (!password) return 'unavailable';
        lastCheckRef.current = Date.now();
        return api.checkStationAuth(password);
      },
      lastCheckAt: () => lastCheckRef.current,
      heldUntil: () => api.stationAuthHeldUntil(),
      current: () => apiRef.current === api,
      onDenied: () => {
        setSavedRejected(true);
        void storeRef.current.forgetStationPassword().then(() => {
          if (alive) setPhase('prompt');
        });
      },
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [listenerAuth, phase, tunedIn, status, api]);

  const unlock = useCallback(
    async (password: string): Promise<StationAuthResult> => {
      if (!api) return 'unavailable';
      lastCheckRef.current = Date.now();
      const result = await api.checkStationAuth(password);
      if (apiRef.current !== api) return 'unavailable';
      if (result === 'ok') {
        await storeRef.current.rememberStationPassword(password);
        setSavedRejected(false);
        const resume = resumeOnAnswer(heldForRef.current === api, result);
        setPhase('ok');
        if (resume && !playerRef.current.tunedIn) playerRef.current.tune();
      }
      return result;
    },
    [api],
  );

  return { phase, readsOpen: stationReadsOpen(privacy, phase), solid, savedRejected, unlock };
}
