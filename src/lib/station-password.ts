import type { CredentialStorage } from './credential-vault';

const STORAGE_KEY = 'subwave.stationPasswords.v1';

export interface StationPasswordStore {
  get(base: string): Promise<string | null>;
  set(base: string, password: string): Promise<void>;
  remove(base: string): Promise<void>;
}

export function createStationPasswordStore(storage: CredentialStorage): StationPasswordStore {
  const read = async (): Promise<Record<string, string>> => {
    const raw = await storage.getItemAsync(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Station password store contains invalid data');
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
      ),
    );
  };
  const write = (values: Record<string, string>) =>
    storage.setItemAsync(STORAGE_KEY, JSON.stringify(values));

  return {
    async get(base) {
      return (await read())[base] ?? null;
    },
    async set(base, password) {
      const values = await read();
      values[base] = password;
      await write(values);
    },
    async remove(base) {
      const values = await read();
      if (!(base in values)) return;
      delete values[base];
      await write(values);
    },
  };
}

// The app rides it on the stream as `?auth=`, like the web player, which also
// lets a Chromecast play it — the receiver cannot send a header.
/** The stream URL with the station password as `?auth=`, or unchanged when
 *  there is none. Icecast forwards the mount's query string to the
 *  controller's /listener-auth, which accepts the token there. */
export function withStreamAuth(url: string, password: string | null | undefined): string {
  if (!password) return url;
  return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(password)}`;
}

export interface StationPrivacy {
  privatePlayer?: boolean;
  listenerAuth?: boolean;
}

export function stationLockRequired(privacy: StationPrivacy | null | undefined): boolean {
  return privacy?.privatePlayer === true || privacy?.listenerAuth === true;
}

export type GatePhase = 'open' | 'checking' | 'prompt' | 'ok';

export function stationReadsOpen(privacy: StationPrivacy | null | undefined, phase: GatePhase): boolean {
  return !stationLockRequired(privacy) || phase === 'ok';
}

export type StationAuthResult = 'ok' | 'denied' | 'rate-limited' | 'unavailable';

export interface StationAuthReply {
  challenged?: boolean;
  body?: unknown;
}

/** Anything else in front of the
 *  controller can answer first: a proxy refusing the Station login challenges
 *  (#1873), a forward-auth proxy (oauth2-proxy in API mode, some Authelia
 *  setups) may not, and a login page answers 200 with HTML. */
export function stationAuthResult(status: number | null, reply: StationAuthReply = {}): StationAuthResult {
  if (status === 200) return okField(reply.body) === true ? 'ok' : 'unavailable';
  if (status === 401) return !reply.challenged && okField(reply.body) === false ? 'denied' : 'unavailable';
  if (status === 429) return 'rate-limited';
  return 'unavailable';
}

function okField(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { ok?: unknown }).ok : undefined;
}

export const RATE_LIMIT_MAX_WAIT_MS = 15 * 60_000;

export function rateLimitedUntil(retryAfter: string | null, now: number): number {
  const sec = Number(retryAfter);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return now + Math.min(sec * 1000, RATE_LIMIT_MAX_WAIT_MS);
}

export interface StoredPasswordVerdict {
  phase: 'ok' | 'prompt';
  save: string | null;
  clearStored: boolean;
}

export async function verifyStoredPasswords(opts: {
  stored: string | null;
  login: string | null;
  check: (password: string) => Promise<StationAuthResult>;
}): Promise<StoredPasswordVerdict> {
  let clearStored = false;
  if (opts.stored) {
    const result = await opts.check(opts.stored);
    if (result === 'denied') clearStored = true;
    else return { phase: 'ok', save: null, clearStored: false };
  }
  if (opts.login && opts.login !== opts.stored) {
    if ((await opts.check(opts.login)) === 'ok') {
      return { phase: 'ok', save: opts.login, clearStored: false };
    }
  }
  return { phase: 'prompt', save: null, clearStored };
}
