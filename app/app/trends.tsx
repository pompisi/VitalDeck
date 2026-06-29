// Trends: pick a metric with the chips, then a line chart of the last 30 days
// with a shaded baseline band (the 14d/30d personal baselines from the api).
import { useQuery } from '@tanstack/react-query';
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
import { getTrends } from '../lib/api';
import type { TrendMetric } from '../lib/types';
import { colors, font, radius, spacing } from '../theme';

// the selectable metrics + their display labels, units, and tint
const METRICS: {
  key: TrendMetric;
  label: string;
  unit: string;
  tint: string;
  digits: number;
}[] = [
  { key: 'readiness_custom', label: 'Readiness', unit: '', tint: colors.accent, digits: 0 },
  { key: 'hrv_rmssd', label: 'HRV', unit: 'ms', tint: colors.hrv, digits: 0 },
  { key: 'resting_hr', label: 'Resting HR', unit: 'bpm', tint: colors.rhr, digits: 0 },
  { key: 'temp_mean_c', label: 'Skin temp', unit: '°C', tint: colors.temp, digits: 2 },
  { key: 'sleep_min', label: 'Sleep', unit: 'min', tint: colors.sleep, digits: 0 },
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

  const chartWidth = Dimensions.get('window').width - spacing.lg * 2 - spacing.lg * 2;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      {/* metric picker chips */}
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

      <View style={styles.card}>
        {trends.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={meta.tint} />
            <Text style={styles.dim}>loading {meta.label.toLowerCase()}…</Text>
          </View>
        ) : trends.isError || !trends.data ? (
          <View style={styles.center}>
            <Text style={styles.errTitle}>Couldn't load trends</Text>
            <Text style={styles.dim}>
              {trends.error instanceof Error
                ? trends.error.message
                : 'unknown error'}
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => trends.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
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
      </View>
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
        <Text style={styles.dim}>No data for this metric yet.</Text>
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

  // the shaded baseline band sits between the 14d and 30d means; gifted-charts
  // draws it via a horizontal "rule" pair isn't built-in, so we approximate the
  // band with a second flat dataset spanning the baseline values
  const haveBand = baseline14 != null && baseline30 != null;
  const bandHi = haveBand ? Math.max(baseline14!, baseline30!) : null;
  const bandLo = haveBand ? Math.min(baseline14!, baseline30!) : null;

  const values = present.map((p) => p.value);
  const dataMin = Math.min(...values, ...(bandLo != null ? [bandLo] : []));
  const dataMax = Math.max(...values, ...(bandHi != null ? [bandHi] : []));
  const pad = (dataMax - dataMin) * 0.15 || 1;

  return (
    <View>
      <View style={styles.legend}>
        {baseline14 != null ? (
          <Text style={styles.legendText}>
            14d {baseline14.toFixed(digits)}
            {unit}
          </Text>
        ) : null}
        {baseline30 != null ? (
          <Text style={styles.legendText}>
            30d {baseline30.toFixed(digits)}
            {unit}
          </Text>
        ) : null}
      </View>
      <LineChart
        data={chartData}
        width={width}
        height={220}
        thickness={2.5}
        color={tint}
        // shading under the line approximates the baseline band fill
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
        // drawing the two baselines as horizontal reference lines that frame the band
        showReferenceLine1={bandHi != null}
        referenceLine1Position={bandHi ?? undefined}
        referenceLine1Config={{
          color: colors.hrv,
          dashWidth: 6,
          dashGap: 4,
          thickness: 1,
        }}
        showReferenceLine2={bandLo != null}
        referenceLine2Position={bandLo ?? undefined}
        referenceLine2Config={{
          color: colors.hrv,
          dashWidth: 6,
          dashGap: 4,
          thickness: 1,
        }}
      />
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
  chips: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  chipTextActive: { color: colors.bg, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
    minHeight: 280,
    justifyContent: 'center',
  },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  errTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  retryText: { color: colors.accent, fontWeight: '700' },
  legend: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  legendText: { color: colors.textFaint, fontSize: font.tiny },
  axisText: { color: colors.textFaint, fontSize: font.tiny },
});
