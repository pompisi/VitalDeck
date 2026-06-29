// SLEEP: rest cycles in the pip-boy idiom — the latest session featured up top
// (big VT323 total time, efficiency/latency readouts, a stacked stage bar with
// a per-stage legend), then prior sessions as compact terminal rows. data +
// states preserved from before; this is the restyle.
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Panel, ScreenHeader } from '../components/Pip';
import { getSleep } from '../lib/api';
import type { SleepSession } from '../lib/types';
import { colors, font, fonts, glow, spacing } from '../theme';

// the four stages in render order, with their tints
const STAGES: { key: keyof SleepSession; label: string; tint: string }[] = [
  { key: 'deep_min', label: 'DEEP', tint: colors.sleep },
  { key: 'rem_min', label: 'REM', tint: colors.hrv },
  { key: 'light_min', label: 'LIGHT', tint: colors.spo2 },
  { key: 'awake_min', label: 'AWAKE', tint: colors.textFaint },
];

const num = (v: unknown): number =>
  typeof v === 'number' && !Number.isNaN(v) ? v : 0;

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}H ${m}M`;
};

const fmtNight = (s: SleepSession): string => {
  try {
    const start = format(new Date(s.start_ms), 'HH:mm');
    const end = format(new Date(s.end_ms), 'HH:mm');
    return `${start} → ${end}`;
  } catch {
    return s.date.toUpperCase();
  }
};

// the session date is a plain YYYY-MM-DD (Oura's wake-up day). parse it as LOCAL —
// `new Date('2026-06-28')` would parse as UTC midnight and then render a day early
// in any timezone west of UTC (e.g. US), which made the latest night read as 06-27.
const fmtDate = (raw: string): string => {
  try {
    return format(parseISO(raw), 'yyyy.MM.dd').toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
};

export default function SleepScreen() {
  const insets = useSafeAreaInsets();
  const sleep = useQuery({
    queryKey: ['sleep', 30],
    queryFn: () => getSleep(30),
  });

  if (sleep.isLoading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={colors.sleep} />
        <Text style={styles.dim}>READING REST CYCLES…</Text>
      </View>
    );
  }

  if (sleep.isError || !sleep.data) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>NO REST DATA</Text>
        <Text style={styles.dim}>
          {sleep.error instanceof Error ? sleep.error.message : 'unknown error'}
        </Text>
        <Pressable style={styles.cmd} onPress={() => sleep.refetch()}>
          <Text style={styles.cmdText}>{'> RETRY'}</Text>
        </Pressable>
      </View>
    );
  }

  const sessions = sleep.data.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>NO REST ON RECORD</Text>
        <Text style={styles.dim}>No sleep sessions logged yet.</Text>
      </View>
    );
  }

  // the api hands sessions back ascending by date; the latest is the last one,
  // but guarding by max end_ms in case ordering ever changes
  const latest = sessions.reduce((a, b) => (b.end_ms > a.end_ms ? b : a));

  const total =
    num(latest.deep_min) +
    num(latest.rem_min) +
    num(latest.light_min) +
    num(latest.awake_min);

  // prior sessions, newest first, excluding the featured latest
  const prior = sessions
    .filter((s) => s !== latest)
    .sort((a, b) => b.end_ms - a.end_ms);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.xxl,
        },
      ]}
    >
      <ScreenHeader title="SLEEP" sub="REST CYCLES // VAULT-DWELLER" />

      {/* the featured latest night */}
      <Panel title="LATEST CYCLE">
        <View style={styles.nightRow}>
          <Ionicons name="moon" size={16} color={colors.sleep} />
          <Text style={styles.nightWindow}>{fmtNight(latest)}</Text>
          <Text style={styles.nightDate}>{fmtDate(latest.date)}</Text>
        </View>

        <Text style={[styles.big, glow(colors.sleep, 12)]}>
          {minutesToHM(latest.total_min)}
        </Text>
        <Text style={styles.bigLabel}>TIME ASLEEP</Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {latest.efficiency != null ? `${Math.round(latest.efficiency)}%` : '--'}
            </Text>
            <Text style={styles.statLabel}>EFFICIENCY</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {latest.latency_min != null ? `${Math.round(latest.latency_min)}M` : '--'}
            </Text>
            <Text style={styles.statLabel}>LATENCY</Text>
          </View>
        </View>

        {/* the stacked stage bar — each stage's width is its share of the night */}
        <View style={styles.barTrack}>
          {total > 0 ? (
            STAGES.map((s) => {
              const m = num(latest[s.key]);
              if (m <= 0) return null;
              return (
                <View
                  key={s.label}
                  style={{ flex: m / total, backgroundColor: s.tint }}
                />
              );
            })
          ) : (
            <View style={styles.barEmpty} />
          )}
        </View>

        {/* the legend — minutes + share per stage */}
        <View style={styles.legend}>
          {STAGES.map((s) => {
            const m = num(latest[s.key]);
            const pct = total > 0 ? Math.round((m / total) * 100) : 0;
            return (
              <View key={s.label} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: s.tint }]} />
                <Text style={styles.legendLabel}>{s.label}</Text>
                <Text style={styles.legendPct}>{String(pct).padStart(3, ' ')}%</Text>
                <Text style={styles.legendMin}>{minutesToHM(m)}</Text>
              </View>
            );
          })}
        </View>
      </Panel>

      {/* prior nights as compact terminal rows */}
      {prior.length > 0 ? (
        <Panel title="PRIOR CYCLES">
          {prior.map((s, i) => (
            <View
              key={s.id ?? `${s.start_ms}`}
              style={[styles.priorRow, i === 0 && styles.priorRowFirst]}
            >
              <Text style={styles.priorDate}>{fmtDate(s.date)}</Text>
              <Text style={styles.priorTotal}>{minutesToHM(s.total_min)}</Text>
              <Text style={styles.priorEff}>
                {s.efficiency != null ? `${Math.round(s.efficiency)}% EFF` : '-- EFF'}
              </Text>
            </View>
          ))}
        </Panel>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center', letterSpacing: 1 },
  errTitle: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },

  nightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nightWindow: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, flex: 1 },
  nightDate: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1 },

  big: {
    color: colors.sleep,
    fontFamily: fonts.display,
    fontSize: font.big,
    lineHeight: font.big + 4,
    marginTop: spacing.md,
  },
  bigLabel: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 2 },

  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },
  statLabel: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 2, marginTop: spacing.xs },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },

  barTrack: {
    flexDirection: 'row',
    height: 18,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  barEmpty: { flex: 1, backgroundColor: colors.surfaceAlt },

  legend: { marginTop: spacing.md, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legendDot: { width: 10, height: 10 },
  legendLabel: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, flex: 1 },
  legendPct: { color: colors.textDim, fontSize: font.small, width: 44, textAlign: 'right' },
  legendMin: { color: colors.text, fontSize: font.small, width: 72, textAlign: 'right', letterSpacing: 1 },

  priorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priorRowFirst: { borderTopWidth: 0, paddingTop: 0 },
  priorDate: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, flex: 1 },
  priorTotal: { color: colors.text, fontSize: font.small, letterSpacing: 1, width: 80, textAlign: 'right' },
  priorEff: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1, width: 80, textAlign: 'right' },

  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },
});
