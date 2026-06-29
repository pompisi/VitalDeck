// Today: the home screen. a big readiness ring with its component breakdown,
// a grid of the headline vitals (resting HR / HRV / skin temp / SpO2), last
// night's sleep summary, a "data as of" line, and a sync button that runs the
// backend pipeline then refetches everything.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import ReadinessRing from '../components/ReadinessRing';
import Section from '../components/Section';
import StatCard from '../components/StatCard';
import { getToday, postSync } from '../lib/api';
import type { ReadinessComponent, StageBreakdown } from '../lib/types';
import { colors, font, radius, scoreColor, spacing } from '../theme';

// the data_as_of value is epoch ms; turning it into a friendly local stamp
const fmtAsOf = (ms: number | null | undefined): string => {
  if (ms == null) return 'no data yet';
  try {
    return format(new Date(ms), "EEE MMM d, h:mm a");
  } catch {
    return 'unknown';
  }
};

// parsing stage_breakdown whether the api gave us an object or a json string
const parseStages = (
  raw: StageBreakdown | string | null | undefined,
): StageBreakdown => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as StageBreakdown;
    } catch {
      return {};
    }
  }
  return raw;
};

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
};

// one row in the readiness breakdown list
function ComponentRow({
  label,
  comp,
}: {
  label: string;
  comp: ReadinessComponent | undefined;
}) {
  const pct = comp ? Math.round(comp.subscore * 100) : null;
  return (
    <View style={styles.compRow}>
      <Text style={styles.compLabel}>{label}</Text>
      <View style={styles.compBarTrack}>
        <View
          style={[
            styles.compBarFill,
            {
              width: `${pct ?? 0}%`,
              backgroundColor: scoreColor(pct),
            },
          ]}
        />
      </View>
      <Text style={styles.compPct}>{pct != null ? `${pct}` : '—'}</Text>
    </View>
  );
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const today = useQuery({
    queryKey: ['summary', 'today'],
    queryFn: getToday,
  });

  // sync runs the backend pipeline; on success we blow away the cache so every
  // tab pulls fresh numbers
  const sync = useMutation({
    mutationFn: postSync,
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });

  if (today.isLoading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.dim}>loading today…</Text>
      </View>
    );
  }

  if (today.isError || !today.data) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>Couldn't reach the server</Text>
        <Text style={styles.dim}>
          {today.error instanceof Error ? today.error.message : 'unknown error'}
        </Text>
        <Pressable style={styles.retryBtn} onPress={() => today.refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { summary, metric, data_as_of } = today.data;
  const stages = parseStages(summary?.stage_breakdown_json);
  const comps = metric?.components;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <Text style={styles.asOf}>Data as of {fmtAsOf(data_as_of)}</Text>

      {/* the centerpiece ring + explanation */}
      <View style={styles.ringWrap}>
        <ReadinessRing score={metric?.readiness_custom ?? null} />
      </View>

      {metric ? (
        <Section title="Readiness breakdown">
          <View style={styles.breakdownCard}>
            <ComponentRow label="HRV" comp={comps?.hrv} />
            <ComponentRow label="Resting HR" comp={comps?.resting_hr} />
            <ComponentRow label="Skin temp" comp={comps?.temp} />
            <ComponentRow label="Sleep" comp={comps?.sleep} />
          </View>
        </Section>
      ) : (
        <Text style={styles.dim}>No readiness score for today yet.</Text>
      )}

      <Section title="Vitals">
        <View style={styles.grid}>
          <StatCard
            label="Resting HR"
            value={summary?.resting_hr}
            unit="bpm"
            tint={colors.rhr}
          />
          <StatCard
            label="HRV (rMSSD)"
            value={summary?.hrv_rmssd}
            unit="ms"
            tint={colors.hrv}
          />
        </View>
        <View style={[styles.grid, { marginTop: spacing.md }]}>
          <StatCard
            label="Skin temp"
            value={summary?.temp_mean_c}
            unit="°C"
            digits={2}
            tint={colors.temp}
          />
          <StatCard
            label="SpO2"
            value={summary?.spo2_avg}
            unit="%"
            digits={1}
            tint={colors.spo2}
          />
        </View>
      </Section>

      <Section title="Last night's sleep">
        <View style={styles.sleepCard}>
          <View style={styles.sleepTop}>
            <Text style={styles.sleepTotal}>
              {minutesToHM(summary?.sleep_min)}
            </Text>
            <Text style={styles.sleepEff}>
              {summary?.sleep_efficiency != null
                ? `${Math.round(summary.sleep_efficiency)}% efficient`
                : 'efficiency —'}
            </Text>
          </View>
          <View style={styles.sleepStages}>
            <SleepStageChip label="Deep" min={stages.deep_min} tint={colors.sleep} />
            <SleepStageChip label="REM" min={stages.rem_min} tint={colors.hrv} />
            <SleepStageChip label="Light" min={stages.light_min} tint={colors.spo2} />
            <SleepStageChip label="Awake" min={stages.awake_min} tint={colors.textFaint} />
          </View>
        </View>
      </Section>

      <Pressable
        style={[styles.syncBtn, sync.isPending && styles.syncBtnBusy]}
        disabled={sync.isPending}
        onPress={() => sync.mutate()}
      >
        {sync.isPending ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Text style={styles.syncText}>Sync now</Text>
        )}
      </Pressable>
      {sync.isError ? (
        <Text style={styles.syncErr}>
          Sync failed:{' '}
          {sync.error instanceof Error ? sync.error.message : 'unknown'}
        </Text>
      ) : null}
      {sync.isSuccess ? (
        <Text style={styles.syncOk}>
          {sync.data.mode === 'synthetic'
            ? `Generated a synthetic day (+${sync.data.ingested} records)`
            : `Synced (+${sync.data.ingested} new, ${sync.data.deduped} dup)`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function SleepStageChip({
  label,
  min,
  tint,
}: {
  label: string;
  min: number | undefined;
  tint: string;
}) {
  return (
    <View style={styles.stageChip}>
      <View style={[styles.stageDot, { backgroundColor: tint }]} />
      <Text style={styles.stageLabel}>{label}</Text>
      <Text style={styles.stageMin}>
        {min != null ? `${Math.round(min)}m` : '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.lg },
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
  asOf: {
    color: colors.textFaint,
    fontSize: font.small,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  ringWrap: { alignItems: 'center', marginVertical: spacing.lg },
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  compLabel: { color: colors.textDim, fontSize: font.small, width: 86 },
  compBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  compBarFill: { height: 8, borderRadius: radius.pill },
  compPct: {
    color: colors.text,
    fontSize: font.small,
    fontWeight: '700',
    width: 28,
    textAlign: 'right',
  },
  grid: { flexDirection: 'row', gap: spacing.md },
  sleepCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sleepTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sleepTotal: { color: colors.text, fontSize: font.big, fontWeight: '800' },
  sleepEff: { color: colors.textDim, fontSize: font.small },
  sleepStages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stageChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stageDot: { width: 10, height: 10, borderRadius: 5 },
  stageLabel: { color: colors.textDim, fontSize: font.small },
  stageMin: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  syncBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  syncBtnBusy: { opacity: 0.7 },
  syncText: { color: colors.bg, fontSize: font.body, fontWeight: '800' },
  syncErr: {
    color: colors.bad,
    fontSize: font.small,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  syncOk: {
    color: colors.good,
    fontSize: font.small,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
