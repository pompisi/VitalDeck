// a compact metric card — the building block for the Today grid (resting HR,
// HRV, skin temp, SpO2). shows a big value, units, label, and an optional
// baseline/delta line tinted by the metric color.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

interface Props {
  label: string;
  value: number | null | undefined;
  unit?: string;
  // how many decimals to show; falls back to a sensible default per-call
  digits?: number;
  tint?: string;
  // optional secondary line, e.g. "14d avg 48ms"
  sub?: string;
}

const fmt = (value: number | null | undefined, digits = 0): string => {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
};

export default function StatCard({
  label,
  value,
  unit,
  digits = 0,
  tint = colors.accent,
  sub,
}: Props) {
  const has = value != null && !Number.isNaN(value as number);
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: has ? tint : colors.textFaint }]}>
          {fmt(value, digits)}
        </Text>
        {unit && has ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flex: 1,
    minWidth: 140,
    minHeight: 96,
    justifyContent: 'space-between',
  },
  label: {
    color: colors.textDim,
    fontSize: font.small,
    fontWeight: '600',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.sm,
  },
  value: {
    fontSize: font.big,
    fontWeight: '800',
    lineHeight: font.big + 2,
  },
  unit: {
    color: colors.textFaint,
    fontSize: font.small,
    marginLeft: spacing.xs,
    marginBottom: 3,
  },
  sub: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: spacing.xs,
  },
});
