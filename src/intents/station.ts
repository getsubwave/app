// The station an App Intent acts on: the one the listener tuned to last, read
// from storage the way StationContext reads it at boot. An intent can run
// before any screen has mounted, so it cannot borrow the context's client.

import { createApi, type StationApi } from '@/lib/api';
import { readActiveStationState } from '@/lib/station';

export interface IntentStation {
  base: string;
  /** Display name from recents, when the store has one. */
  name: string | null;
  api: StationApi;
}

export { NO_STATION_MESSAGE } from './station-messages';

export async function activeStation(): Promise<IntentStation | null> {
  const { store, credentials, password } = await readActiveStationState();
  const base = store.activeStation;
  if (!base) return null;
  return {
    base,
    name: store.recents.find((r) => r.url === base)?.name ?? null,
    api: createApi(base, credentials, () => password),
  };
}
