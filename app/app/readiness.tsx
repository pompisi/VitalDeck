// READINESS detail (pushed route off STATUS): the ring as hero, the condition word,
// the "biggest drag" explanation + temp flag, and our four explainable contributors
// as bars (value vs baseline, weight, subscore) each with a "> WHY?" note. all data
// is already in /summary/today's metric (components + explanation + temp_flag).
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ExplainNote from '../components/ExplainNote';
import { Bar, Panel } from '../components/Pip';
import ReadinessRing from '../components/ReadinessRing';
import { getToday } from '../lib/api';
import type { ReadinessComponent } from '../lib/types';
import { cToF } from '../lib/units';
import { colors, font, fonts, glow, scoreColor, spacing } from '../theme';

const conditionWord = (s: number | null): string =>
  s == null ? 'NO DATA' : s >= 75 ? 'OPTIMAL' : s >= 50 ? 'FAIR' : s >= 25 ? 'STRAINED' : 'CRITICAL';

type Meta = { key: 'hrv' | 'resting_hr' | 'temp' | 'sleep'; label: string; unit: string; digits: number; temp?: boolean };
const CONTRIB: Meta[] = [
  { key: 'hrv', label: 'HRV', unit: 'MS', digits: 0 },
  { key: 'resting_hr', label: 'RESTING HR', unit: 'BPM', digits: 0 },
  { key: 'temp', label: 'SKIN TEMP', unit: '°F', digits: 1, temp: true },
  { key: 'sleep', label: 'SLEEP', unit: 'MIN', digits: 0 },
];

function Contributor({ c, meta }: { c?: ReadinessComponent; meta: Meta }) {
  if (!c) return null;
  const sub = typeof c.subscore === 'number' ? c.subscore : 0.5;
  const col = scoreColor(sub * 100);
  const val = meta.temp ? cToF(c.value ?? null) : c.value ?? null;
  const base = meta.temp ? cToF(c.baseline ?? null) : c.baseline ?? null;
  return (
    <View style={styles.cRow}>
      <View style={styles.cHead}>
        <Text style={styles.cLabel}>{meta.label}</Text>
        <Text style={styles.cWeight}>×{typeof c.weight === 'number' ? c.weight.toFixed(2) : '--'}</Text>
        <Text style={[styles.cPct, { color: col }]}>{Math.round(sub * 100)}</Text>
      </View>
      <Bar value={sub} color={col} />
      <ExplainNote note={c.note} value={val} baseline={base} subscore={sub} unit={meta.unit} digits={meta.digits} />
    </View>
  );
}

export default function ReadinessScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = useQuery({ queryKey: ['summary', 'today'], queryFn: getToday });

  const metric = today.data?.metric;
  const comps = metric?.components;
  const score = metric?.readiness_custom ?? null;
  const tint = scoreColor(score);
  const explanation = metric?.explanation ?? null;
  const tempFlag = metric?.temp_flag ?? null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="chevron-back" size={18} color={colors.textDim} />
        <Text style={styles.backText}>STATUS</Text>
      </Pressable>
      <Text style={styles.head}>READINESS</Text>
      <View style={styles.headRule} />

      {today.isLoading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.text} />
          <Text style={styles.dim}>SCORING…</Text>
        </View>
      ) : !metric ? (
        <View style={styles.fill}>
          <Text style={styles.dim}>NO READINESS ON RECORD</Text>
        </View>
      ) : (
        <>
          <View style={styles.ringWrap}>
            <ReadinessRing score={score} caption="READINESS" size={188} />
            <Text style={[styles.cond, { color: tint }, glow(tint, 8)]}>{conditionWord(score)}</Text>
            {explanation ? <Text style={styles.explain}>{explanation.toUpperCase()}</Text> : null}
          </View>

          {tempFlag?.flagged ? (
            <View style={styles.flag}>
              <Ionicons name="warning-outline" size={14} color={colors.bad} />
              <Text style={styles.flagText}>{tempFlag.note?.toUpperCase() ?? 'TEMP ANOMALY'}</Text>
            </View>
          ) : null}

          <Panel title="CONTRIBUTORS">
            {CONTRIB.map((m) => (
              <Contributor key={m.key} c={comps?.[m.key]} meta={m} />
            ))}
          </Panel>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: spacing.sm },
  backText: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 1 },
  head: { color: colors.text, fontFamily: fonts.display, fontSize: 44, lineHeight: 46, ...glow() },
  headRule: { height: 2, backgroundColor: colors.border, marginVertical: spacing.xs },

  fill: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  dim: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, textAlign: 'center' },

  ringWrap: { alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm },
  cond: { fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 2 },
  explain: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1, textAlign: 'center', paddingHorizontal: spacing.lg },

  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.bad,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginTop: spacing.lg,
  },
  flagText: { color: colors.bad, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1, flexShrink: 1 },

  cRow: { marginVertical: spacing.sm },
  cHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 },
  cLabel: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 1, flex: 1 },
  cWeight: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  cPct: { fontFamily: fonts.display, fontSize: font.title },
});
