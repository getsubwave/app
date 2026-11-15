// RN has no mask-image, and a colour overlay would not match the cover tint
// behind the page, so the column's top and bottom fade is each line's own
// opacity, falling off with its distance from the centre.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useLyricClock, type TrackLyrics } from '@/hooks/useTrackLyrics';
import { lyricFocusLine, lyricMoment, lyricWordCount, lyricWordParts, syncedLyricsReady } from '@/lib/lyrics';
import type { PublicLyricsPayload } from '@/lib/types';
import { useTheme } from '@/theme/ThemeContext';

const EASE = Easing.bezier(0.3, 0.7, 0.2, 1);

const TICK_MS = 250;

const GROW = 1.2;
const LINE_WIDTH = `${Math.floor(100 / GROW)}%` as const;

const FONT_FAMILY = 'Fraunces_600SemiBold';
const FONT_SIZE = 19;
// A little looser than the web's 1.05, to leave the display face's ascenders
// room in RN's exact line box.
const LINE_HEIGHT = 23;
const SYNCED_GAP = 8;
const PLAIN_GAP = 4;

const PAST = 0.28;
const AHEAD = 0.45;
const CLEAR = 0.56;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) setReduce(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return reduce;
}

function Words({ text, lit, accentNewest }: { text: string; lit: number; accentNewest: boolean }) {
  const { colors } = useTheme();
  // Nested Text takes no opacity, and a theme colour may be rgb(), so unsung
  // words wear the muted ink.
  return (
    <>
      {lyricWordParts(text).map(({ part, index }, i) => {
        if (index < 0) return part;
        const newest = accentNewest && index === lit - 1;
        const color = newest ? colors.accent : index < lit ? colors.ink : colors.muted;
        return (
          <Text key={i} style={{ color }}>
            {part}
          </Text>
        );
      })}
    </>
  );
}

type Tone = 'past' | 'sung' | 'ahead';

const Line = memo(function Line({
  index,
  text,
  tone,
  lit,
  accentNewest,
  fade,
  reduceMotion,
  onMeasure,
}: {
  index: number;
  text: string;
  tone: Tone;
  lit: number;
  accentNewest: boolean;
  fade: number;
  reduceMotion: boolean;
  onMeasure: (index: number, centre: number) => void;
}) {
  const { colors } = useTheme();
  const opacityTo = (tone === 'past' ? PAST : tone === 'ahead' ? AHEAD : 1) * fade;
  const scaleTo = tone === 'sung' ? GROW : 1;
  const [opacity] = useState(() => new Animated.Value(opacityTo));
  const [scale] = useState(() => new Animated.Value(scaleTo));

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(opacityTo);
      scale.setValue(scaleTo);
      return;
    }
    const run = Animated.parallel([
      Animated.timing(opacity, { toValue: opacityTo, duration: 500, easing: EASE, useNativeDriver: true }),
      Animated.timing(scale, { toValue: scaleTo, duration: 500, easing: EASE, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [reduceMotion, opacity, opacityTo, scale, scaleTo]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    onMeasure(index, y + height / 2);
  };

  // The animation drives the wrapper, never the Text. A Text whose children
  // turn from a string into elements (the line becoming the sung one) remounts
  // its native view, since RN wraps only element children in a text-ancestor
  // context, and Android's native driver throws when the props node, still
  // attached to the old view, is connected to the new one.
  return (
    <Animated.View
      onLayout={onLayout}
      style={{
        paddingVertical: SYNCED_GAP,
        opacity,
        transform: [{ scale }],
        transformOrigin: 'left center',
      }}
    >
      <Text
        style={{
          width: LINE_WIDTH,
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
          color: colors.ink,
        }}
      >
        {tone === 'sung' ? <Words text={text} lit={lit} accentNewest={accentNewest} /> : text}
      </Text>
    </Animated.View>
  );
});

function SyncedColumn({
  lyrics,
  positionMs,
  reduceMotion,
}: {
  lyrics: PublicLyricsPayload;
  positionMs: number;
  reduceMotion: boolean;
}) {
  const { lines } = lyrics;
  const moment = lyricMoment(lyrics, positionMs);
  const focus = lyricFocusLine(lyrics, moment, positionMs);
  const sung = moment.current >= 0 ? lines[moment.current] : null;
  const wordCount = sung ? lyricWordCount(sung.text) : 0;
  const lit = reduceMotion ? wordCount : Math.max(1, Math.ceil(moment.progress * wordCount));

  const [height, setHeight] = useState(0);
  const onContainerLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
  };

  const [centres, setCentres] = useState<number[]>([]);
  const pending = useRef<number[]>([]);
  const onMeasure = useCallback((index: number, centre: number) => {
    pending.current[index] = centre;
    setCentres((prev) => (prev[index] === centre ? prev : [...pending.current]));
  }, []);
  const measured = centres.length === lines.length && centres.every((c) => typeof c === 'number');

  const [y] = useState(() => new Animated.Value(0));
  const [shown] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const target = -(centres[focus] ?? 0);
  useEffect(() => {
    if (!measured) return;
    if (!placed.current || reduceMotion) {
      placed.current = true;
      y.setValue(target);
      if (reduceMotion) shown.setValue(1);
      else Animated.timing(shown, { toValue: 1, duration: 500, easing: EASE, useNativeDriver: true }).start();
      return;
    }
    const run = Animated.timing(y, { toValue: target, duration: 600, easing: EASE, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [measured, target, reduceMotion, y, shown]);

  const half = height / 2;
  const focusCentre = centres[focus] ?? 0;
  const fadeFor = (i: number) => {
    if (!measured || half <= 0) return 1;
    const dist = Math.abs((centres[i] ?? 0) - focusCentre);
    return Math.min(1, Math.max(0, (half - dist) / ((1 - CLEAR) * half)));
  };

  return (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={onContainerLayout}
      pointerEvents="none"
      accessible
      accessibilityLabel={sung ? `Lyrics: ${sung.text}` : 'Lyrics'}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: half,
          opacity: shown,
          transform: [{ translateY: y }],
        }}
      >
        {lines.map((line, i) => {
          const tone: Tone = i === moment.current ? 'sung' : i < focus ? 'past' : 'ahead';
          return (
            <Line
              key={i}
              index={i}
              text={line.text}
              tone={tone}
              lit={tone === 'sung' ? lit : 0}
              accentNewest={tone === 'sung' && !reduceMotion && moment.progress < 1}
              fade={fadeFor(i)}
              reduceMotion={reduceMotion}
              onMeasure={onMeasure}
            />
          );
        })}
      </Animated.View>
    </View>
  );
}

function PlainColumn({ lines }: { lines: { text: string }[] }) {
  const { colors } = useTheme();
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingVertical: 24 }}
      showsVerticalScrollIndicator={false}
      accessibilityLabel="Lyrics"
    >
      {lines.map((line, i) =>
        line.text.trim() ? (
          <Text
            key={i}
            style={{
              width: LINE_WIDTH,
              fontFamily: FONT_FAMILY,
              fontSize: FONT_SIZE,
              lineHeight: LINE_HEIGHT,
              paddingVertical: PLAIN_GAP,
              color: colors.ink,
              opacity: 0.7,
            }}
          >
            {line.text}
          </Text>
        ) : (
          <View key={i} style={{ height: 15 }} />
        ),
      )}
    </ScrollView>
  );
}

export interface StageLyricsProps {
  track: TrackLyrics;
  trackStartedAt: number | null;
  running: boolean;
}

export default memo(function StageLyrics({ track, trackStartedAt, running }: StageLyricsProps) {
  const reduceMotion = useReduceMotion();
  const positionMs = useLyricClock(track, trackStartedAt, running, TICK_MS);
  const { lyrics } = track;
  const synced = syncedLyricsReady(track);
  const lines = useMemo(() => lyrics?.lines ?? [], [lyrics]);

  return (
    <View style={{ flex: 1, paddingHorizontal: 20, marginTop: 8, marginBottom: 12 }}>
      {lyrics && lines.length > 0 ? (
        synced ? (
          <SyncedColumn
            key={`${lyrics.songId ?? ''}:${lines.length}`}
            lyrics={lyrics}
            positionMs={positionMs}
            reduceMotion={reduceMotion}
          />
        ) : (
          <PlainColumn key={lyrics.songId ?? ''} lines={lines} />
        )
      ) : null}
    </View>
  );
});
