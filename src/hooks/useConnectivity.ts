import NetInfo, { type NetInfoStateType } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export interface Connectivity {
  isConnected: boolean | null;
  type: NetInfoStateType | null;
}

export function useConnectivity(): Connectivity {
  const [state, setState] = useState<Connectivity>({ isConnected: null, type: null });

  useEffect(() => {
    let alive = true;
    NetInfo.fetch()
      .then((s) => {
        if (alive) setState({ isConnected: s.isConnected, type: s.type });
      })
      .catch(() => {});
    const unsub = NetInfo.addEventListener((s) => {
      setState({ isConnected: s.isConnected, type: s.type });
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return state;
}
