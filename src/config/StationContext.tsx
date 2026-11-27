import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { setStations } from '../../modules/app-intents';
import { teardown } from '@/audio/player';
import { createApi, type StationApi } from '@/lib/api';
import {
  clearActiveStation,
  clearStationPassword,
  featuredStation,
  loadStationCredentials,
  loadStationPassword,
  loadStations,
  onStationStoreChanged,
  removeRecent,
  saveStationCredentials,
  saveStationPassword,
  setActiveStation,
  type StationRef,
  type StationStore,
} from '@/lib/station';
import { splitStationAddress, type StationCredentials } from '@/lib/station-credentials';
import { stationsForSiri } from '@/lib/station-store';

interface StationContextValue {
  ready: boolean;
  base: string | null;
  api: StationApi | null;
  name: string | null;
  recents: StationRef[];
  featured: StationRef;
  selectStation: (
    ref: StationRef,
    credentials?: StationCredentials | null,
  ) => Promise<void>;
  credentialsFor: (url: string) => Promise<StationCredentials | null>;
  hasLogin: boolean;
  saveLogin: (url: string, credentials: StationCredentials | null) => Promise<void>;
  stationPassword: string | null;
  loginPassword: string | null;
  rememberStationPassword: (password: string) => Promise<void>;
  forgetStationPassword: () => Promise<void>;
  stationPasswordSaved: (url: string) => Promise<boolean>;
  forgetStationPasswordFor: (url: string) => Promise<void>;
  forgetStation: (url: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<StationContextValue | null>(null);

/** The stored store plus the active station's login and password, as the
 *  screens need them. A keychain failure leaves either null rather than
 *  failing the read. */
async function readStationState(): Promise<{
  store: StationStore;
  credentials: StationCredentials | null;
  password: string | null;
}> {
  const s = await loadStations();
  let activeCredentials: StationCredentials | null = null;
  let activePassword: string | null = null;
  try {
    activeCredentials = s.activeStation
      ? await loadStationCredentials(s.activeStation)
      : null;
  } catch {
    // Boot without credentials if the keychain fails; later actions report failure
    // and leave the vault intact.
  }
  try {
    activePassword = s.activeStation ? await loadStationPassword(s.activeStation) : null;
  } catch {
    // Same: a locked station then asks again rather than failing to boot.
  }
  return { store: s, credentials: activeCredentials, password: activePassword };
}

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<StationStore>({ activeStation: null, recents: [] });
  const [credentials, setCredentials] = useState<StationCredentials | null>(null);
  const [stationPassword, setStationPasswordState] = useState<string | null>(null);
  const stationPasswordRef = useRef<string | null>(null);
  const setStationPassword = useCallback((password: string | null) => {
    stationPasswordRef.current = password;
    setStationPasswordState(password);
  }, []);
  const [ready, setReady] = useState(false);
  const featured = useMemo(() => featuredStation(), []);

  useEffect(() => {
    let alive = true;
    readStationState().then((s) => {
      if (alive) {
        setStore(s.store);
        setCredentials(s.credentials);
        setStationPassword(s.password);
        setReady(true);
      }
    }).catch(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [setStationPassword]);

  // A station switch from Siri, Shortcuts or Spotlight (src/intents/tune.ts)
  // writes the store and starts the new stream itself; follow it. No teardown,
  // unlike selectStation: the stream already playing is the new station's.
  useEffect(
    () =>
      onStationStoreChanged(() => {
        readStationState()
          .then((s) => {
            setCredentials(s.credentials);
            setStationPassword(s.password);
            setStore(s.store);
          })
          .catch(() => {});
      }),
    [setStationPassword],
  );

  const selectStation = useCallback(async (
    ref: StationRef,
    suppliedCredentials?: StationCredentials | null,
  ) => {
    const nextCredentials = suppliedCredentials === undefined
      ? await loadStationCredentials(ref.url)
      : suppliedCredentials;
    const next = await setActiveStation(
      ref,
      suppliedCredentials === undefined ? undefined : nextCredentials,
    );
    const nextPassword = await loadStationPassword(ref.url).catch(() => null);
    await teardown();
    setCredentials(nextCredentials);
    setStationPassword(nextPassword);
    setStore(next);
  }, [setStationPassword]);

  const credentialsFor = useCallback(
    (url: string) => loadStationCredentials(url),
    [],
  );

  const forgetStation = useCallback(async (url: string) => {
    const next = await removeRecent(url);
    setStore(next);
  }, []);

  const signOut = useCallback(async () => {
    await teardown();
    const next = await clearActiveStation();
    setCredentials(null);
    setStationPassword(null);
    setStore(next);
  }, [setStationPassword]);

  const base = store.activeStation;
  const rememberStationPassword = useCallback(async (password: string) => {
    if (!base) return;
    setStationPassword(password);
    await saveStationPassword(base, password).catch(() => {});
  }, [base, setStationPassword]);
  const forgetStationPassword = useCallback(async () => {
    if (!base) return;
    setStationPassword(null);
    await clearStationPassword(base).catch(() => {});
  }, [base, setStationPassword]);
  const stationPasswordSaved = useCallback(async (url: string) => {
    if (splitStationAddress(url).base === base) return stationPasswordRef.current !== null;
    return (await loadStationPassword(url)) !== null;
  }, [base]);
  const forgetStationPasswordFor = useCallback(async (url: string) => {
    await clearStationPassword(url);
    if (splitStationAddress(url).base === base) setStationPassword(null);
  }, [base, setStationPassword]);
  const saveLogin = useCallback(async (url: string, next: StationCredentials | null) => {
    await saveStationCredentials(url, next);
    if (splitStationAddress(url).base === base) setCredentials(next);
  }, [base]);

  const api = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => (base ? createApi(base, credentials, () => stationPasswordRef.current) : null),
    [base, credentials],
  );
  const name = useMemo(() => {
    if (!base) return null;
    return store.recents.find((r) => r.url === base)?.name ?? null;
  }, [base, store.recents]);

  // Siri, Shortcuts and Spotlight know the saved stations by name, and cannot
  // read this store.
  useEffect(() => {
    if (ready) setStations(base, stationsForSiri(store.recents));
  }, [ready, base, store.recents]);

  const value = useMemo<StationContextValue>(
    () => ({
      ready,
      base,
      api,
      name,
      recents: store.recents,
      featured,
      selectStation,
      credentialsFor,
      hasLogin: credentials !== null,
      saveLogin,
      stationPassword,
      loginPassword: credentials?.password || null,
      rememberStationPassword,
      forgetStationPassword,
      stationPasswordSaved,
      forgetStationPasswordFor,
      forgetStation,
      signOut,
    }),
    [
      ready,
      base,
      api,
      name,
      store.recents,
      featured,
      selectStation,
      credentialsFor,
      saveLogin,
      stationPassword,
      credentials,
      rememberStationPassword,
      forgetStationPassword,
      stationPasswordSaved,
      forgetStationPasswordFor,
      forgetStation,
      signOut,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStation(): StationContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStation must be used within StationProvider');
  return v;
}
