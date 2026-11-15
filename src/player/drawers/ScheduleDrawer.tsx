import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import ExpandableText from '@/components/ExpandableText';
import { useAppActive } from '@/hooks/useAppActive';
import type { StationApi } from '@/lib/api';
import { normalizeStationLocale, type StationLocale } from '@/lib/format';
import { onNowShow, personaBlurbs, personaById } from '@/lib/schedule';
import type {
  ActiveShow,
  ScheduleShow,
  SchedulePersona,
  SchedulePayload,
  StationContext,
} from '@/lib/types';
import { useTheme } from '@/theme/ThemeContext';

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtHour(hour: number, locale: StationLocale): string {
  if (locale === 'en-US') {
    const h = hour % 24;
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  }
  return `${pad2(hour)}:00`;
}

function fmtHourRange(start: number, end: number, locale: StationLocale): string {
  return `${fmtHour(start, locale)} – ${fmtHour((end + 1) % 24, locale)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Use station-local day/hour; fall back when Hermes lacks timeZone support.
function tzNow(now: Date, tz?: string | null): { day: number; hour: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const day = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
      let hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
      if (hour === 24) hour = 0; // some engines emit "24" at midnight
      if (day >= 0 && Number.isFinite(hour)) return { day, hour };
    } catch {
    }
  }
  return { day: now.getDay(), hour: now.getHours() };
}

interface Slot {
  hour: number;
  endHour: number;
  show: ScheduleShow | null;
  persona: SchedulePersona | null;
}

function collapseSlots(
  dayGrid: (string | null)[],
  shows: ScheduleShow[],
  personas: SchedulePersona[],
): Slot[] {
  const showById = new Map(shows.map((s) => [s.id, s]));
  const personaById = new Map(personas.map((p) => [p.id, p]));
  const out: Slot[] = [];
  let i = 0;
  while (i < 24) {
    const id = dayGrid?.[i] ?? null;
    let j = i;
    while (j + 1 < 24 && (dayGrid?.[j + 1] ?? null) === id) j++;
    const show = id ? showById.get(id) || null : null;
    const persona = show ? personaById.get(show.personaId) || null : null;
    out.push({ hour: i, endHour: j, show, persona });
    i = j + 1;
  }
  return out;
}

function PersonaName({
  name,
  expandable,
  open,
  onToggle,
  className,
  style,
  numberOfLines,
  controlStyle,
}: {
  name: string;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  controlStyle?: StyleProp<ViewStyle>;
}) {
  if (!expandable) {
    return <Text className={className} style={style} numberOfLines={numberOfLines}>{name}</Text>;
  }
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${name}, about this DJ`}
      hitSlop={6}
      style={controlStyle}
    >
      <Text
        className={className}
        style={[style, { textDecorationLine: 'underline', textDecorationStyle: 'dotted' }]}
        numberOfLines={numberOfLines}
      >
        {name}
      </Text>
    </Pressable>
  );
}

function PersonaPanel({ blurbs }: { blurbs: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: 6, gap: 6, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: colors.softBorder }}>
      {blurbs.map((b, i) => (
        <ExpandableText key={i} text={b} lines={4} className="font-body text-muted" style={{ fontSize: 12, lineHeight: 18 }} />
      ))}
    </View>
  );
}

function OnNowCard({
  activeShow,
  show,
  host,
}: {
  activeShow: ActiveShow;
  show: ScheduleShow | null;
  host: SchedulePersona | null;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const hostName = host?.name || activeShow.persona?.name || '';
  const blurbs = personaBlurbs(host);
  const guestNames = (activeShow.guests || []).map((g) => g?.name).filter(Boolean);
  return (
    <View style={{ borderWidth: 1, borderColor: colors.accent, padding: 12, marginBottom: 16 }}>
      <Text className="font-mono text-accent" style={{ fontSize: 9, letterSpacing: 3, marginBottom: 4 }}>ON NOW</Text>
      <Text className="font-body-semibold text-ink" style={{ fontSize: 16 }}>{activeShow.name}</Text>
      {hostName || guestNames.length ? (
        <View className="flex-row flex-wrap mt-0.5" style={{ alignItems: 'baseline' }}>
          <Text className="font-body text-muted" style={{ fontSize: 12 }}>with </Text>
          {hostName ? (
            <PersonaName
              name={hostName}
              expandable={blurbs.length > 0}
              open={open}
              onToggle={() => setOpen((v) => !v)}
              className="font-body text-muted"
              style={{ fontSize: 12 }}
            />
          ) : null}
          {guestNames.length ? (
            <Text className="font-body text-muted" style={{ fontSize: 12 }}>
              {hostName ? ' & ' : ''}{guestNames.join(' & ')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {open ? <PersonaPanel blurbs={blurbs} /> : null}
      {show?.topic ? (
        <View style={{ marginTop: 8 }}>
          <ExpandableText text={show.topic} lines={3} className="font-body text-muted" style={{ fontSize: 12, lineHeight: 18 }} />
        </View>
      ) : null}
    </View>
  );
}

function SlotRow({ slot, isNow, locale, api }: { slot: Slot; isNow: boolean; locale: StationLocale; api: StationApi }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const blurbs = personaBlurbs(slot.persona);
  const avatar = slot.persona?.avatar ? api.avatar(slot.persona.avatar) : '';
  return (
    <View
      className="flex-row items-start"
      style={{
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.softBorder,
        opacity: slot.show ? 1 : 0.5,
      }}
    >
      <Text className="font-mono" style={{ fontSize: 11, width: 92, paddingTop: 2, color: isNow ? colors.accent : colors.muted }}>
        {fmtHourRange(slot.hour, slot.endHour, locale)}
      </Text>
      {avatar ? (
        <Image
          source={{ uri: avatar, headers: api.imageHeaders(avatar) }}
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.field }}
          contentFit="cover"
        />
      ) : null}
      <View className="flex-1">
        <Text className="font-body-medium text-ink" style={{ fontSize: 14 }} numberOfLines={1}>
          {slot.show?.name || 'Autopilot'}
        </Text>
        {slot.persona?.name ? (
          <PersonaName
            name={slot.persona.name}
            expandable={blurbs.length > 0}
            open={open}
            onToggle={() => setOpen((v) => !v)}
            className="font-body text-muted"
            style={{ fontSize: 11 }}
            numberOfLines={1}
            controlStyle={{ alignSelf: 'flex-start', maxWidth: '100%' }}
          />
        ) : null}
        {open ? <PersonaPanel blurbs={blurbs} /> : null}
        {slot.show?.topic ? (
          <View style={{ marginTop: 4 }}>
            <ExpandableText text={slot.show.topic} lines={2} className="font-body text-muted" style={{ fontSize: 11, lineHeight: 16 }} />
          </View>
        ) : null}
      </View>
      {isNow ? (
        <Text className="font-mono text-accent" style={{ fontSize: 9, letterSpacing: 2, paddingTop: 3 }}>NOW</Text>
      ) : null}
    </View>
  );
}

export interface ScheduleDrawerProps {
  api: StationApi;
  activeShow: ActiveShow | null;
  context: StationContext | null;
}

export default function ScheduleDrawer({ api, activeShow, context }: ScheduleDrawerProps) {
  const { colors } = useTheme();
  const appActive = useAppActive();
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const location = context?.weather?.location ?? null;

  useEffect(() => {
    if (!appActive) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [appActive]);

  useEffect(() => {
    let alive = true;
    api
      .schedule()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Schedule unavailable.'); });
    return () => { alive = false; };
  }, [api]);

  if (err) {
    return <Text className="font-body text-muted" style={{ fontSize: 13 }}>{err}</Text>;
  }
  if (!data) {
    return <Text className="font-body text-muted" style={{ fontSize: 13 }}>Loading schedule…</Text>;
  }

  const { day: todayTz, hour: currentHour } = tzNow(now, data.timezone);
  const day = pickedDay ?? todayTz;
  const locale = normalizeStationLocale(data.locale);

  const slots = collapseSlots(data.schedule?.[day] ?? [], data.shows || [], data.personas || []);

  const gridShowId = data.schedule?.[todayTz]?.[currentHour] ?? null;
  const onNow = onNowShow(
    activeShow,
    (data.shows || []).find((s) => s.id === gridShowId) ?? null,
    data.shows,
  );
  const onNowHost = personaById(data.personas, activeShow?.persona?.id);

  // Hermes may lack Intl timeZone support; fall back to device-local time.
  let time: string;
  try {
    time = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: locale === 'en-US',
      ...(data.timezone ? { timeZone: data.timezone } : {}),
    }).format(now);
  } catch {
    time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  }

  return (
    <View>
      <View
        className="flex-row items-end justify-between"
        style={{
          gap: 16,
          paddingBottom: 12,
          marginBottom: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.softBorder,
        }}
      >
        <View>
          <Text className="font-mono text-muted" style={{ fontSize: 9, letterSpacing: 3 }}>STATION TIME</Text>
          <Text className="font-body-semibold text-ink" style={{ fontSize: 24, marginTop: 4 }}>{time}</Text>
        </View>
        {location ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text className="font-mono text-muted" style={{ fontSize: 9, letterSpacing: 3 }}>LOCATION</Text>
            <Text className="font-body text-ink" style={{ fontSize: 14, marginTop: 4 }}>{location}</Text>
          </View>
        ) : null}
      </View>

      {activeShow?.name ? (
        <OnNowCard key={activeShow.name} activeShow={activeShow} show={onNow} host={onNowHost} />
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
        <View className="flex-row" style={{ gap: 6 }}>
          {DAY_LABELS.map((label, d) => {
            const active = d === day;
            return (
              <Pressable
                key={label}
                onPress={() => setPickedDay(d)}
                accessibilityRole="button"
                accessibilityLabel={`Day ${label}`}
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: active ? colors.ink : colors.softBorder,
                  backgroundColor: active ? colors.ink : 'transparent',
                }}
              >
                <Text
                  className="font-mono"
                  style={{ fontSize: 10, letterSpacing: 1, color: active ? colors.bg : colors.muted }}
                >
                  {label}
                  {d === todayTz ? ' ·' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {slots.map((slot) => (
        <SlotRow
          key={`${day}-${slot.hour}`}
          slot={slot}
          isNow={day === todayTz && currentHour >= slot.hour && currentHour <= slot.endHour}
          locale={locale}
          api={api}
        />
      ))}
    </View>
  );
}
