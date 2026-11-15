// The stream itself is
// never probed, since every probe would count a phantom listener, so a proxy
// that guards only the stream goes unseen.

import type { HealthResult } from './api';
import type { StationCredentials } from './station-credentials';
import type { StationAuthResult } from './station-password';

/** Whether a health answer is the station refusing the login: a 401 whose
 *  `WWW-Authenticate` asks for Basic, which is how an HTTP Basic Auth proxy
 *  asks for a login. The app sends the login only as Basic, so a challenge in
 *  any other scheme (Bearer, Digest, Negotiate) turns it away whatever it is,
 *  and editing it cannot help. A 403 is not
 *  a refusal: an IP allowlist, a WAF or a Cloudflare challenge page sends
 *  one whatever the login, and editing the login cannot fix it. A timeout, a
 *  network error or any other status says nothing about the login either, and
 *  a 407 comes from a proxy on the listener's own network. */
export function loginRefused(result: HealthResult): boolean {
  if (result.ok || result.kind !== 'http' || result.status !== 401) return false;
  return basicChallenge(result.challenge);
}

/** Whether a `WWW-Authenticate` header offers Basic. A scheme is a
 *  case-insensitive token that opens the header or follows a comma, since one
 *  header may list several challenges (`Bearer realm="x", Basic realm="y"`).
 *  Quoted strings go first, so a realm that mentions Basic is not one, and
 *  neither is another scheme's `basic=` parameter. */
function basicChallenge(header: string | undefined): boolean {
  if (!header) return false;
  const unquoted = header.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return /(?:^|,)\s*basic(?=[\s,]|$)(?!\s*=)/i.test(unquoted);
}

export type LoginCheck =
  | { verdict: 'accepted' }
  | { verdict: 'rejected'; by: 'proxy' | 'stream-password' }
  | { verdict: 'unreachable'; rateLimited: boolean };

export function saveAnywayOffered(check: LoginCheck): boolean {
  return check.verdict === 'unreachable' || (check.verdict === 'rejected' && check.by === 'stream-password');
}

const ACCEPTED: LoginCheck = { verdict: 'accepted' };
const UNREACHABLE: LoginCheck = { verdict: 'unreachable', rateLimited: false };

export async function checkStationLogin(opts: {
  login: StationCredentials;
  health: (login: StationCredentials | null) => Promise<HealthResult>;
  streamPassword: () => Promise<boolean | null>;
  checkStationAuth: (password: string) => Promise<StationAuthResult>;
}): Promise<LoginCheck> {
  const withLogin = await opts.health(opts.login);
  if (!withLogin.ok) {
    return loginRefused(withLogin) ? { verdict: 'rejected', by: 'proxy' } : UNREACHABLE;
  }

  const locked = await opts.streamPassword();
  if (locked === null) return UNREACHABLE;
  if (!locked) return ACCEPTED;

  const auth = await opts.checkStationAuth(opts.login.password);
  if (auth === 'ok') return ACCEPTED;
  if (auth !== 'denied') return { verdict: 'unreachable', rateLimited: auth === 'rate-limited' };

  const anonymous = await opts.health(null);
  if (loginRefused(anonymous)) return ACCEPTED;
  return anonymous.ok ? { verdict: 'rejected', by: 'stream-password' } : UNREACHABLE;
}
