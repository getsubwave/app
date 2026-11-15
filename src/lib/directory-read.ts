import { FETCH_TIMEOUT_MS, fetchWithTimeout, readJson } from './api';
import type { DirectoryStation } from './directory';

export async function readDirectory(url: () => string, signal?: AbortSignal): Promise<DirectoryStation[]> {
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(url(), { cache: 'no-store', signal });
    if (!res.ok) return [];
    const data = await readJson(res, FETCH_TIMEOUT_MS - (Date.now() - startedAt));
    return Array.isArray(data) ? (data as DirectoryStation[]) : [];
  } catch {
    return [];
  }
}
