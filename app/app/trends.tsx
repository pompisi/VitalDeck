// TRENDS: pick a metric with the terminal toggle chips, then a phosphor line
// chart of the last 30 days framed by the 14d/30d personal baselines. data +
// states are unchanged — this is the pip-boy restyle to match STATUS.
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Panel, ScreenHeader } from '../components/Pip';
import { getTrends } from '../lib/api';
import type { TrendMetric } from '../lib/types';
import { colors, font, fonts, glow, spacing } from '../theme';

// the selectable metrics + their CAPS labels, units, and tint
const METRICS: {
  key: TrendMetric;
  label: string;
  unit: string;
  tint: string;
  digits: number;
}[] = [
  { key: 'readiness_custom', label: 'READINESS', unit: '', tint: colors.accent, digits: 0 },
  { key: 'hrv_rmssd', label: 'HRV', unit: 'ms', tint: colors.hrv, digits: 0 },
  { key: 'resting_hr', label: 'RESTING HR', unit: 'bpm', tint: colors.rhr, digits: 0 },
  { key: 'temp_mean_c', label: 'SKIN TEMP', unit: 'C', tint: colors.temp, digits: 2 },
  { key: 'sleep_min', label: 'SLEEP', unit: 'min', tint: colors.sleep, digits: 0 },
  { key: 'spo2_avg', label: 'SpO2', unit: '%', tint: colors.spo2, digits: 1 },
];

const DAYS = 30;

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const [metric, setMetric] = useState<TrendMetric>('readiness_custom');
  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  const trends = useQuery({
    queryKey: ['trends', metric, DAYS],
    queryFn: () => getTrends(metric, DAYS),
  });

  // chart sits inside content padding (lg) + Panel padding (md) on each side
  const chartWidth =
    Dimensions.get('window').width - spacing.lg * 2 - spacing.md * 2;

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
      <ScreenHeader title="TRENDS" sub={`30-DAY HISTORY // ${meta.label}`} />

      {/* metric picker — terminal toggle chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {METRICS.map((m) => {
          const active = m.key === metric;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMetric(m.key)}
              style={[
                styles.chip,
                active && { backgroundColor: m.tint, borderColor: m.tint },
              ]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Panel title="HISTORY PLOT">
        {trends.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={meta.tint} />
            <Text style={styles.dim}>READING ARCHIVE…</Text>
          </View>
        ) : trends.isError || !trends.data ? (
          <View style={styles.center}>
            <Text style={styles.errTitle}>ARCHIVE READ FAILED</Text>
            <Text style={styles.dim}>
              {trends.error instanceof Error
                ? trends.error.message
                : 'unknown error'}
            </Text>
            <Pressable style={styles.cmd} onPress={() => trends.refetch()}>
              <Text style={styles.cmdText}>> RETRY</Text>
            </Pressable>
          </View>
        ) : (
          <TrendChart
            data={trends.data.points}
            baseline14={trends.data.baseline_14}
            baseline30={trends.data.baseline_30}
            tint={meta.tint}
            unit={meta.unit}
            digits={meta.digits}
            width={chartWidth}
          />
        )}
      </Panel>
    </ScrollView>
  );
}

function TrendChart({
  data,
  baseline14,
  baseline30,
  tint,
  unit,
  digits,
  width,
}: {
  data: { date: string; value: number | null }[];
  baseline14: number | null;
  baseline30: number | null;
  tint: string;
  unit: string;
  digits: number;
  width: number;
}) {
  // only the days that actually have a value carry a dot; missing days still
  // hold their x-slot but render as a gap
  const present = data.filter((p) => p.value != null) as {
    date: string;
    value: number;
  }[];

  if (present.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="pulse-outline" size={28} color={colors.textFaint} />
        <Text style={styles.dim}>NO ARCHIVE FOR THIS METRIC</Text>
      </View>
    );
  }

  // building the line from only the present points — synthesizing 0 for gap days
  // would collapse the line to the axis (and spike negative under the y-offset),
  // so we drop the missing days entirely and keep the real points' date labels
  const step = Math.max(1, Math.floor(present.length / 6));
  const chartData = present.map((p, i) => ({
    value: p.value,
    label: i % step === 0 ? safeLabel(p.date) : undefined,
    dataPointColor: tint,
  }));

  // the baseline band sits between the 14d and 30d means; gifted-charts has no
  // built-in band, so we frame it with a pair of dim horizontal reference lines
  const haveBand = baseline14 != null && baseline30 != null;
  const bandHi = haveBand ? Math.max(baseline14!, baseline30!) : null;
  const bandLo = haveBand ? Math.min(baseline14!, baseline30!) : null;

  const values = present.map((p) => p.value);
  const dataMin = Math.min(...values, ...(bandLo != null ? [bandLo] : []));
  const dataMax = Math.max(...values, ...(bandHi != null ? [bandHi] : []));
  const pad = (dataMax - dataMin) * 0.15 || 1;

  const latest = present[present.length - 1].value;

  return (
    <View>
      <LineChart
        data={chartData}
        width={width}
        height={220}
        thickness={2.5}
        color={tint}
        dataPointsColor={tint}
        // shading under the line gives the phosphor sweep look
        areaChart
        startFillColor={tint}
        endFillColor={colors.bg}
        startOpacity={0.18}
        endOpacity={0.02}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.border}
        rulesType="dashed"
        yAxisTextStyle={styles.axisText}
        xAxisLabelTextStyle={styles.axisText}
        textColor={colors.text}
        hideOrigin
        initialSpacing={spacing.md}
        endSpacing={spacing.md}
        adjustToWidth
        maxValue={dataMax + pad}
        yAxisOffset={Math.max(0, dataMin - pad)}
        curved
        // the two baselines drawn as dim-amber horizontal reference lines
        showReferenceLine1={bandHi != null}
        referenceLine1Position={bandHi ?? undefined}
        referenceLine1Config={{
          color: colors.warn,
          dashWidth: 6,
          dashGap: 4,
          thickness: 1,
        }}
        showReferenceLine2={bandLo != null}
        referenceLine2Position={bandLo ?? undefined}
        referenceLine2Config={{
          color: colors.warn,
          dashWidth: 6,
          dashGap: 4,
          thickness: 1,
        }}
      />

      {/* readouts: latest + the two personal baselines */}
      <View style={styles.statRule} />
      <View style={styles.statRow}>
        <Stat
          label="LATEST"
          value={`${latest.toFixed(digits)}${unit}`}
          color={tint}
          glowing
        />
        <Stat
          label="14-DAY BASE"
          value={baseline14 != null ? `${baseline14.toFixed(digits)}${unit}` : '--'}
          color={colors.warn}
        />
        <Stat
          label="30-DAY BASE"
          value={baseline30 != null ? `${baseline30.toFixed(digits)}${unit}` : '--'}
          color={colors.warn}
        />
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  color,
  glowing,
}: {
  label: string;
  value: string;
  color: string;
  glowing?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }, glowing ? glow(color, 10) : null]}>
        {value}
      </Text>
    </View>
  );
}

const safeLabel = (iso: string): string => {
  try {
    return format(parseISO(iso), 'M/d');
  } catch {
    return '';
  }
};

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },

  chips: { gap: spacing.sm, paddingTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: font.small,
    letterSpacing: 1,
  },
  chipTextActive: { color: colors.bg },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  dim: {
    color: colors.textDim,
    fontSize: font.small,
    textAlign: 'center',
    letterSpacing: 1,
  },
  errTitle: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },

  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cmdText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: font.body,
    letterSpacing: 1,
  },

  axisText: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },

  statRule: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statLabel: {
    color: colors.textDim,
    fontSize: font.tiny,
    letterSpacing: 1,
    marginBottom: 2,
  },
  statValue: { fontFamily: fonts.display, fontSize: font.big, lineHeight: font.big + 2 },
});
