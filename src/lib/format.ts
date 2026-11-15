export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '–:––';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export type StationLocale = 'en-GB' | 'en-US';

export const DEFAULT_STATION_LOCALE: StationLocale = 'en-GB';

export function normalizeStationLocale(locale: unknown): StationLocale {
  return locale === 'en-US' ? 'en-US' : DEFAULT_STATION_LOCALE;
}

function stationClockOptions(locale: StationLocale): Intl.DateTimeFormatOptions {
  return locale === 'en-US' ? { hour12: true } : { hour12: false };
}

export function fmtClock(
  t: string | number | null | undefined,
  tz?: string | null,
  locale?: StationLocale | null,
): string {
  if (t == null) return '';
  const stationLocale = normalizeStationLocale(locale);
  try {
    return new Date(t).toLocaleTimeString(stationLocale, {
      ...stationClockOptions(stationLocale),
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch {
    return String(t);
  }
}

export function fmtClockMinute(
  t: string | number | Date,
  tz?: string | null,
  locale?: StationLocale | null,
): string {
  const stationLocale = normalizeStationLocale(locale);
  try {
    return new Date(t).toLocaleTimeString(stationLocale, {
      hour: '2-digit',
      minute: '2-digit',
      ...stationClockOptions(stationLocale),
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch {
    return '';
  }
}

export function playedAt(e: {
  t?: unknown;
  startedAt?: unknown;
  queuedAt?: unknown;
} | null | undefined): string | null {
  for (const v of [e?.startedAt, e?.t, e?.queuedAt]) {
    if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return v;
  }
  return null;
}

export function relTime(t: string | number | Date): string {
  const diff = (Date.now() - new Date(t).getTime()) / 1000;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
