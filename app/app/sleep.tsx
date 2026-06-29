// Sleep: the latest sleep session in detail — a proportional stage-breakdown
// bar, per-stage minutes, and the efficiency/latency numbers.
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
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
import Section from '../components/Section';
import { getSleep } from '../lib/api';
import type { SleepSession } from '../lib/types';
import { colors, font, radius, spacing } from '../theme';

// the four stages in render order, with their tints
const STAGES: { key: keyof SleepSession; label: string; tint: string }[] = [
  { key: 'deep_min', label: 'Deep', tint: colors.sleep },
  { key: 'rem_min', label: 'REM', tint: colors.hrv },
  { key: 'light_min', label: 'Light', tint: colors.spo2 },
  { key: 'awake_min', label: 'Awake', tint: colors.textFaint },
];

const num = (v: unknown): number =>
  typeof v === 'number' && !Number.isNaN(v) ? v : 0;

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
};

const fmtNight = (s: SleepSession): string => {
  try {
    const start = format(new Date(s.start_ms), 'h:mm a');
    const end = format(new Date(s.end_ms), 'h:mm a');
    return `${start} → ${end}`;
  } catch {
    return s.date;
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
        <Text style={styles.dim}>loading sleep…</Text>
      </View>
    );
  }

  if (sleep.isError || !sleep.data) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>Couldn't load sleep</Text>
        <Text style={styles.dim}>
          {sleep.error instanceof Error ? sleep.error.message : 'unknown error'}
        </Text>
        <Pressable style={styles.retryBtn} onPress={() => sleep.refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const sessions = sleep.data.sessions ?? [];
  if (sessions.length === 0) {
    return (
      <View style={styles.fill}>
        <Text style={styles.dim}>No sleep sessions recorded yet.</Text>
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

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <Text style={styles.night}>{fmtNight(latest)}</Text>
      <Text style={styles.date}>{latest.date}</Text>

      <View style={styles.summaryRow}>
        <Big label="Time asleep" value={minutesToHM(latest.total_min)} />
        <Big
          label="Efficiency"
          value={
            latest.efficiency != null
              ? `${Math.round(latest.efficiency)}%`
              : '—'
          }
        />
        <Big
          label="Latency"
          value={
            latest.latency_min != null
              ? `${Math.round(latest.latency_min)}m`
              : '—'
          }
        />
      </View>

      <Section title="Stage breakdown">
        {/* the proportional bar — each stage's width is its share of the night */}
        <View style={styles.bar}>
          {total > 0 ? (
            STAGES.map((s) => {
              const m = num(latest[s.key]);
              if (m <= 0) return null;
              return (
                <View
                  key={s.label}
                  style={{
                    flex: m / total,
                    backgroundColor: s.tint,
                  }}
                />
              );
            })
          ) : (
            <View style={[styles.bar, { backgroundColor: colors.surfaceAlt }]} />
          )}
        </View>

        <View style={styles.stageList}>
          {STAGES.map((s) => {
            const m = num(latest[s.key]);
            const pct = total > 0 ? Math.round((m / total) * 100) : 0;
            return (
              <View key={s.label} style={styles.stageRow}>
                <View style={[styles.stageDot, { backgroundColor: s.tint }]} />
                <Text style={styles.stageLabel}>{s.label}</Text>
                <Text style={styles.stagePct}>{pct}%</Text>
                <Text style={styles.stageMin}>{minutesToHM(m)}</Text>
              </View>
            );
          })}
        </View>
      </Section>
    </ScrollView>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.bigCard}>
      <Text style={styles.bigValue}>{value}</Text>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
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
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  errTitle: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  retryText: { color: colors.accent, fontWeight: '700' },
  night: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '800',
    textAlign: 'center',
  },
  date: {
    color: colors.textFaint,
    fontSize: font.small,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  bigCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
  },
  bigValue: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  bigLabel: { color: colors.textDim, fontSize: font.tiny, marginTop: spacing.xs },
  bar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  stageList: { gap: spacing.md },
  stageRow: { flexDirection: 'row', alignItems: 'center' },
  stageDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.md },
  stageLabel: { color: colors.text, fontSize: font.body, flex: 1 },
  stagePct: {
    color: colors.textDim,
    fontSize: font.small,
    width: 48,
    textAlign: 'right',
  },
  stageMin: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '700',
    width: 72,
    textAlign: 'right',
  },
});
