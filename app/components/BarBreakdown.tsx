// a generic explainable contributor breakdown: each row is a label, optional
// ×weight, the 0-100 subscore, a phosphor bar, and a "> WHY?" disclosure (note +
// value-vs-baseline). data-driven so any composite (sleep quality now, activity /
// vitals later) can render the same way ContributorBars does for readiness.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ExplainNote from './ExplainNote';
import { Bar } from './Pip';
import { colors, font, fonts, scoreColor, spacing } from '../theme';

export type BreakdownRow = {
  label: string;
  subscore: number; // 0-1
  weight?: number | null;
  note?: string | null;
  value?: number | null;
  baseline?: number | null;
  unit?: string;
  digits?: number;
};

export default function BarBreakdown({ rows }: { rows: BreakdownRow[] }) {
  return (
    <>
      {rows.map((r) => {
        const sub = typeof r.subscore === 'number' ? r.subscore : 0.5;
        const col = scoreColor(sub * 100);
        return (
          <View key={r.label} style={styles.cRow}>
            <View style={styles.cHead}>
              <Text style={styles.cLabel}>{r.label}</Text>
              {typeof r.weight === 'number' ? <Text style={styles.cWeight}>×{r.weight.toFixed(2)}</Text> : null}
              <Text style={[styles.cPct, { color: col }]}>{Math.round(sub * 100)}</Text>
            </View>
            <Bar value={sub} color={col} />
            <ExplainNote note={r.note} value={r.value} baseline={r.baseline} subscore={sub} unit={r.unit} digits={r.digits} />
          </View>
        );
      })}
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
