// The rules match patterns rather than trusting the call sites, because a
// playback error's text isn't the app's own. Android's is ExoPlayer's fixed
// wording and RNTP's code, neither of which quotes a URL, but iOS's is the
// localizedDescription of whatever AVPlayer failed on, and nothing promises
// what that says.

export const PLAYBACK_LOG_LIMIT = 300;

export const PLAYBACK_LINE_MAX = 500;

const REDACTED = '[redacted]';

// A slash may be backslashed: Apple's JSONSerialization writes https:\/\/ by
// default. encodeURIComponent leaves ' ( ) ! * ~ as they are, so neither the
// query nor an auth= value below may stop at one: a station password "it's"
// would leave "'s" behind.
const URL_USERINFO_RE = /(:\\*\/\\*\/)[^\s/?#]*@/g;
const URL_QUERY_RE = /(:\\*\/\\*\/[^\s?#"'<>]*)(?:[?#][^\s"<>]*)?/g;
const HEADER_RE =
  /\b((?:proxy-)?authorization)(\\*["']?\s*[:=](?:\s*(?:optional)?[\\"'[(]+)*\s*)(?:[^\s"',;)}\]]*?\b(basic|bearer|digest)\s+)?[^\s"',;)}\]]*/gi;
const STATION_AUTH_RE = /\b(x-station-auth\\*["']?\s*[:=]\s*)[\s\S]*$/i;
const CREDENTIAL_RE = /\b(basic|bearer)\s+([A-Za-z0-9+/._~-]+={0,2})/gi;
const CREDENTIAL_MIN = 8;
const CREDENTIAL_PROSE = /^(?:authentication|authorization|credentials)\.?$/i;
const AUTH_PARAM_RE = /(^|[^\w-])auth=[^\s&#"<>,;}\]]*/gi;
// [\s\S], since a device name can hold a line terminator, which `.` stops at.
const ROUTE_OUTPUTS_RE = /\boutputs=([\s\S]*)$/;

/** `msg` with every secret the rules above know of removed. */
export function redactPlaybackLine(msg: string): string {
  return msg
    .replace(STATION_AUTH_RE, `$1${REDACTED}`)
    .replace(HEADER_RE, (_m, name: string, sep: string, scheme?: string) =>
      `${name}${sep}${scheme ? `${scheme} ` : ''}${REDACTED}`,
    )
    .replace(CREDENTIAL_RE, (m, scheme: string, token: string) =>
      token.length < CREDENTIAL_MIN || CREDENTIAL_PROSE.test(token) ? m : `${scheme} ${REDACTED}`,
    )
    .replace(URL_USERINFO_RE, '$1')
    .replace(URL_QUERY_RE, '$1')
    .replace(AUTH_PARAM_RE, (_m, before: string) => `${before}auth=${REDACTED}`)
    .replace(ROUTE_OUTPUTS_RE, (_m, outputs: string) => `outputs=${portTypes(outputs)}`);
}

// Every AVAudioSession.Port raw value in the iOS 27.1 SDK. AVFAudio's
// AVAudioSessionTypes.h names the 22 ports but not their strings, so a new
// SDK's port goes here by hand, and reads as OTHER_PORT until it does. The
// inputs can't be in a route's outputs. One of them, the Continuity microphone,
// is listed under both spellings in use, since Apple doesn't publish its string.
const PORT_TYPES = new Set([
  'ContinuityMicrophone',
  'MicrophoneContinuity',
  'LineIn',
  'MicrophoneBuiltIn',
  'MicrophoneWired',
  'LineOut',
  'Headphones',
  'BluetoothA2DPOutput',
  'Receiver',
  'Speaker',
  'HDMIOutput',
  'AirPlay',
  'BluetoothLE',
  'MediaDeviceExtension',
  'BluetoothHFP',
  'USBAudio',
  'CarAudio',
  'Virtual',
  'PCI',
  'FireWire',
  'DisplayPort',
  'AVB',
  'Thunderbolt',
]);
const OTHER_PORT = 'Other';

function portTypes(outputs: string): string {
  return outputs
    .split(',')
    .map((o) => /^([A-Za-z0-9]+):/.exec(o)?.[1])
    .filter((t): t is string => !!t)
    .map((t) => (PORT_TYPES.has(t) ? t : OTHER_PORT))
    .join(',');
}

// What the event line reads off a track-player event. A PlaybackError isn't the
// shape RNTP types: Android sends `code` and `message`, each only when it has
// one, and iOS sends `error`, a localizedDescription or null. The `error` on a
// PlaybackState in state=error is a { code, message } object, and stays out.
export interface PlaybackEventFields {
  type: string;
  state?: unknown;
  code?: unknown;
  message?: unknown;
  error?: unknown;
}

/** The line for a track-player event, with its error's code and text. The text
 *  comes last, so the cut can't take the code. */
export function playbackEventLine(event: PlaybackEventFields): string {
  const text = [event.message, event.error].find((t): t is string => typeof t === 'string');
  return [
    `event ${event.type}`,
    ...('state' in event ? [`state=${String(event.state)}`] : []),
    ...(typeof event.code === 'string' ? [`code=${event.code}`] : []),
    ...(text !== undefined ? [`msg=${text}`] : []),
  ].join(' ');
}

export class PlaybackLog {
  private readonly limit: number;
  private readonly now: () => number;
  private entries: string[] = [];

  constructor(limit = PLAYBACK_LOG_LIMIT, now: () => number = Date.now) {
    this.limit = limit;
    this.now = now;
  }

  /** Stamp, redact and keep `msg`, dropping the oldest line past the limit.
   *  Never throws: plog runs mid-reload and ahead of each event's dispatch, so a
   *  throw here would wedge the recovery (#2160). Hermes can throw from a regex
   *  past its limits, and a line that can't be redacted is lost, never kept raw. */
  add(msg: string): void {
    try {
      const clean = redactPlaybackLine(msg);
      const cut = clean.length > PLAYBACK_LINE_MAX ? `${clean.slice(0, PLAYBACK_LINE_MAX)}…` : clean;
      this.entries.push(`${new Date(this.now()).toISOString()} ${cut}`);
      if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    } catch {}
  }

  /** The kept lines, oldest first. */
  lines(): string[] {
    return [...this.entries];
  }
}

/** The app's one log, written by usePlayer's plog. */
export const playbackLog = new PlaybackLog();

export interface PlaybackLogSource {
  /** The app version, e.g. "1.6.1". */
  version: string;
  /** The JS bundle running, e.g. "OTA 1a2b3c4d, production"; null when unknown. */
  bundle: string | null;
  /** "iOS" or "Android". */
  platform: string;
  /** e.g. "18.2", or "15 (API 35)". */
  osVersion: string;
}

/** The text the About sheet shares: what is running, then the lines. */
export function playbackLogReport(source: PlaybackLogSource, lines: readonly string[]): string {
  const bundle = source.bundle ? ` (${source.bundle})` : '';
  return [
    `SUB/WAVE app ${source.version}${bundle} · ${source.platform} ${source.osVersion}`,
    `Playback log: ${lines.length} line${lines.length === 1 ? '' : 's'}, oldest first, times in UTC.`,
    '',
    ...lines,
  ].join('\n');
}
