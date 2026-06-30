// our four explainable readiness contributors as labeled phosphor bars — each row
// is the metric, its weight (×0.40…), the 0-100 subscore, the bar, and a "> WHY?"
// disclosure (the backend note + value-vs-baseline). shared by the readiness detail
// screen and the unified day-detail screen so the two never drift. temp values are
// shown in °F to match the rest of the app (storage/scoring stay Celsius).
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ExplainNote from './ExplainNote';
import { Bar } from './Pip';
import type { ReadinessComponent, ReadinessComponents } from '../lib/types';
import { cToF } from '../lib/units';
import { colors, font, fonts, scoreColor, spacing } from '../theme';

type Meta = {
  key: keyof ReadinessComponents;
  label: string;
  unit: string;
  digits: number;
  temp?: boolean;
};

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

export default function ContributorBars({ components }: { components?: ReadinessComponents }) {
  return (
    <>
      {CONTRIB.map((m) => (
        <Contributor key={m.key} c={components?.[m.key]} meta={m} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  cRow: { marginVertical: spacing.sm },
  cHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 },
  cLabel: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 1, flex: 1 },
  cWeight: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  cPct: { fontFamily: fonts.display, fontSize: font.title },
});
