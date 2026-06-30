// SLEEP: a day explorer. pick a night from the day strip, then see its hypnogram
// (stage timeline), the stage breakdown (min + % of asleep, Oura-style), the night
// window/efficiency/latency, and that day's vitals + readiness. tap days to browse
// history. data: /sleep (sessions, incl. the `stages` timeline) + /summary/{date}.
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Hypnogram from '../components/Hypnogram';
import MetricCurve, { seriesToPoints } from '../components/MetricCurve';
import { Panel, ScreenHeader } from '../components/Pip';
import { getSleep, getSummary } from '../lib/api';
import type { SleepSeries, SleepSession, SleepStage } from '../lib/types';
import { cToF } from '../lib/units';
import { colors, font, fonts, glow, scoreColor, spacing } from '../theme';

const STAGES = [
  { stage: 'deep', label: 'DEEP', tint: colors.sleep, isSleep: true },
  { stage: 'rem', label: 'REM', tint: colors.hrv, isSleep: true },
  { stage: 'light', label: 'LIGHT', tint: colors.spo2, isSleep: true },
  { stage: 'awake', label: 'AWAKE', tint: colors.textFaint, isSleep: false },
] as const;

const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
};

const n0 = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? '--' : String(Math.round(v));

const fmtWindow = (s: SleepSession): string => {
  try {
    return `${format(new Date(s.start_ms), 'h:mm a')} → ${format(new Date(s.end_ms), 'h:mm a')}`;
  } catch {
    return s.date;
  }
};

const fmtDate = (raw: string): string => {
  try {
    return format(parseISO(raw), 'EEE · yyyy.MM.dd').toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
};

const weekday = (raw: string): string => {
  try {
    return format(parseISO(raw), 'EEE').toUpperCase();
  } catch {
    return '';
  }
};
const mmdd = (raw: string): string => {
  try {
    return format(parseISO(raw), 'MM.dd');
  } catch {
    return raw;
  }
};

const parseStageList = (raw: SleepStage[] | string | null | undefined): SleepStage[] => {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SleepStage[];
    } catch {
      return [];
    }
  }
  return raw;
};

const parseSeries = (raw: SleepSeries | string | null | undefined): SleepSeries | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SleepSeries;
    } catch {
      return null;
    }
  }
  return raw;
};

export default function SleepScreen() {
  const insets = useSafeAreaInsets();
  const sleep = useQuery({ queryKey: ['sleep', 30], queryFn: () => getSleep(30) });
  const [selDate, setSelDate] = useState<string | null>(null);
  const [curve, setCurve] = useState<'hr' | 'hrv'>('hr');

  const sessions = useMemo(
    () => [...(sleep.data?.sessions ?? [])].sort((a, b) => b.end_ms - a.end_ms),
    [sleep.data],
  );
  const selected = sessions.find((s) => s.date === selDate) ?? sessions[0] ?? null;
  const dayDate = selected?.date ?? null;

  const day = useQuery({
    queryKey: ['summary', dayDate],
    queryFn: () => getSummary(dayDate as string),
    enabled: !!dayDate,
  });

  const chartW = Dimensions.get('window').width - spacing.lg * 2 - spacing.md * 2;

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
  if (!selected) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>NO REST ON RECORD</Text>
        <Text style={styles.dim}>No sleep sessions logged yet.</Text>
      </View>
    );
  }

  const stageMin: Record<string, number> = {
    deep: num(selected.deep_min),
    rem: num(selected.rem_min),
    light: num(selected.light_min),
    awake: num(selected.awake_min),
  };
  const asleep = stageMin.deep + stageMin.rem + stageMin.light;
  const inBed = asleep + stageMin.awake;
  const pct = (x: number) => (asleep > 0 ? Math.round((x / asleep) * 100) : 0);
  const stageList = parseStageList(selected.stages ?? selected.stages_json);
  const series = parseSeries(selected.series);
  const curveBlock = curve === 'hr' ? series?.hr : series?.hrv;
  const curvePts = seriesToPoints(curveBlock);
  const curveVals = curvePts.filter((p) => p.value != null).map((p) => p.value as number);

  const summ = day.data?.summary;
  const readiness = day.data?.metric?.readiness_custom ?? null;
  const tempF = cToF(summ?.temp_mean_c);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <ScreenHeader title="SLEEP" sub="REST CYCLES // VAULT-DWELLER" />

      {/* day strip — tap to browse past nights */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {sessions.map((s) => {
          const active = s.date === selected.date;
          return (
            <Pressable
              key={s.id ?? s.start_ms}
              onPress={() => setSelDate(s.date)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipDay, active && styles.chipTextActive]}>{weekday(s.date)}</Text>
              <Text style={[styles.chipDate, active && styles.chipTextActive]}>{mmdd(s.date)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Panel title="REST CYCLE">
        <View style={styles.nightRow}>
          <Ionicons name="moon" size={16} color={colors.sleep} />
          <Text style={styles.nightWindow}>{fmtWindow(selected)}</Text>
          <Text style={styles.nightDate}>{fmtDate(selected.date)}</Text>
        </View>

        <Text style={[styles.big, glow(colors.sleep, 12)]}>{minutesToHM(selected.total_min)}</Text>
        <Text style={styles.bigLabel}>TIME ASLEEP · IN BED {minutesToHM(inBed)}</Text>

        <View style={styles.statRow}>
          <Stat label="EFFICIENCY" value={selected.efficiency != null ? `${Math.round(selected.efficiency)}%` : '--'} />
          <View style={styles.statDivider} />
          <Stat label="LATENCY" value={selected.latency_min != null ? `${Math.round(selected.latency_min)}M` : '--'} />
        </View>

        {series?.hr || series?.hrv ? (
          <View style={styles.curveWrap}>
            <View style={styles.curveHead}>
              <Text style={styles.curveTitle}>OVERNIGHT</Text>
              <View style={styles.curveChips}>
                {(['hr', 'hrv'] as const).map((k) =>
                  (k === 'hr' ? series?.hr : series?.hrv) ? (
                    <Pressable
                      key={k}
                      onPress={() => setCurve(k)}
                      style={[styles.curveChip, curve === k && styles.curveChipActive]}
                    >
                      <Text style={[styles.curveChipText, curve === k && styles.curveChipTextActive]}>
                        {k.toUpperCase()}
                      </Text>
                    </Pressable>
                  ) : null,
                )}
              </View>
            </View>
            <MetricCurve
              points={curvePts}
              width={chartW}
              tint={curve === 'hr' ? colors.rhr : colors.hrv}
              startMs={selected.start_ms}
              endMs={selected.end_ms}
            />
            <View style={styles.curveStats}>
              <Text style={styles.curveStat}>MIN {curveVals.length ? Math.round(Math.min(...curveVals)) : '--'}</Text>
              <Text style={styles.curveStat}>
                AVG {curveVals.length ? Math.round(curveVals.reduce((a, b) => a + b, 0) / curveVals.length) : '--'}
              </Text>
              <Text style={styles.curveStat}>MAX {curveVals.length ? Math.round(Math.max(...curveVals)) : '--'}</Text>
            </View>
          </View>
        ) : null}

        {stageList.length > 0 ? (
          <View style={styles.graphWrap}>
            <Hypnogram stages={stageList} width={chartW} startMs={selected.start_ms} endMs={selected.end_ms} />
          </View>
        ) : (
          <View style={styles.barTrack}>
            {inBed > 0 ? (
              STAGES.map((s) => {
                const m = stageMin[s.stage];
                if (m <= 0) return null;
                return <View key={s.label} style={{ flex: m / inBed, backgroundColor: s.tint }} />;
              })
            ) : (
              <View style={styles.barEmpty} />
            )}
          </View>
        )}

        <View style={styles.legend}>
          {STAGES.map((s) => {
            const m = stageMin[s.stage];
            return (
              <View key={s.label} style={styles.legRow}>
                <View style={[styles.legDot, { backgroundColor: s.tint }]} />
                <Text style={styles.legLabel}>{s.label}</Text>
                <View style={styles.legBarWrap}>
                  <View
                    style={[
                      styles.legBar,
                      { width: `${inBed > 0 ? (m / inBed) * 100 : 0}%`, backgroundColor: s.tint },
                    ]}
                  />
                </View>
                <Text style={styles.legMin}>{minutesToHM(m)}</Text>
                <Text style={styles.legPct}>{s.isSleep ? `${pct(m)}%` : ''}</Text>
              </View>
            );
          })}
        </View>
      </Panel>

      <Panel title="THAT DAY">
        {day.isLoading ? (
          <Text style={styles.dim}>READING…</Text>
        ) : (
          <View style={styles.metricGrid}>
            <Metric label="READINESS" value={readiness != null ? String(Math.round(readiness)) : '--'} color={scoreColor(readiness)} />
            <Metric label="RESTING HR" value={n0(summ?.resting_hr)} unit="BPM" />
            <Metric label="HRV" value={n0(summ?.hrv_rmssd)} unit="MS" />
            <Metric label="SKIN TEMP" value={tempF != null ? tempF.toFixed(1) : '--'} unit="°F" />
            <Metric label="SpO2" value={n0(summ?.spo2_avg)} unit="%" />
            <Metric label="RESP" value={n0(summ?.resp_rate)} unit="BR/M" />
          </View>
        )}
      </Panel>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Metric({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.metricUnit}>{` ${unit}`}</Text> : null}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center', letterSpacing: 1 },
  errTitle: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },
  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },

  chips: { gap: spacing.sm, paddingTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    minWidth: 58,
  },
  chipActive: { borderColor: colors.text, backgroundColor: colors.surfaceAlt },
  chipDay: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  chipDate: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 1 },
  chipTextActive: { color: colors.text },

  nightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nightWindow: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, flex: 1 },
  nightDate: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1 },

  big: { color: colors.sleep, fontFamily: fonts.display, fontSize: font.big, lineHeight: font.big + 4, marginTop: spacing.md },
  bigLabel: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 2 },

  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },
  statLabel: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 2, marginTop: spacing.xs },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },

  graphWrap: { marginTop: spacing.sm },
  curveWrap: { marginTop: spacing.md },
  curveHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  curveTitle: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 2 },
  curveChips: { flexDirection: 'row', gap: spacing.xs },
  curveChip: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  curveChipActive: { borderColor: colors.text, backgroundColor: colors.surfaceAlt },
  curveChipText: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  curveChipTextActive: { color: colors.text },
  curveStats: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.xs },
  curveStat: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
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
  legRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legDot: { width: 10, height: 10 },
  legLabel: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, width: 56 },
  legBarWrap: { flex: 1, height: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  legBar: { height: '100%' },
  legMin: { color: colors.text, fontSize: font.small, width: 64, textAlign: 'right', letterSpacing: 1 },
  legPct: { color: colors.textDim, fontSize: font.tiny, width: 38, textAlign: 'right' },

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metric: { width: '33.33%', paddingVertical: spacing.sm },
  metricValue: { color: colors.text, fontFamily: fonts.display, fontSize: 28, lineHeight: 30 },
  metricUnit: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  metricLabel: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 1, marginTop: 2 },
});
