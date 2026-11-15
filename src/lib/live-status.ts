import { createApi, type StationApi } from './api';
import type { StationCredentials } from './station-credentials';

export async function liveStatusClient(
  url: string,
  savedLogin: (url: string) => Promise<StationCredentials | null>,
): Promise<StationApi> {
  const login = await savedLogin(url).catch(() => undefined);
  return createApi(url, login);
}
