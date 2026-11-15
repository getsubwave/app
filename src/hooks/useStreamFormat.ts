import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  availableFormats,
  effectiveFormat,
  loadFormatPref,
  saveFormatPref,
  type StreamFormat,
  type StreamFormatOption,
} from '@/lib/streamFormat';
import type { StreamInfo } from '@/lib/types';

export interface StreamFormatControl {
  format: StreamFormat;
  preference: StreamFormat;
  options: StreamFormatOption[];
  setFormat: (f: StreamFormat) => void;
}

export function useStreamFormat(
  base: string | null,
  streamInfo: StreamInfo | null,
): StreamFormatControl {
  const [preference, setPreference] = useState<StreamFormat>('mp3');

  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
    setPreference('mp3');
    if (!base) return;
    let alive = true;
    loadFormatPref(base).then((stored) => {
      if (alive && stored && baseRef.current === base) setPreference(stored);
    });
    return () => {
      alive = false;
    };
  }, [base]);

  const setFormat = useCallback((f: StreamFormat) => {
    setPreference(f);
    if (baseRef.current) void saveFormatPref(baseRef.current, f);
  }, []);

  const options = useMemo(() => availableFormats(streamInfo), [streamInfo]);
  const format = useMemo(() => effectiveFormat(preference, streamInfo), [preference, streamInfo]);

  return { format, preference, options, setFormat };
}
