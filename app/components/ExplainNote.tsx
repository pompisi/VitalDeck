// a terminal-style "> WHY?" disclosure for a metric/contributor: tap to expand the
// backend's human note plus value-vs-baseline and the subscore. data comes straight
// from a readiness component ({note, value, baseline, subscore}).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, fonts } from '../theme';

const fmt = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(v) ? '--' : v.toFixed(digits);

export default function ExplainNote({
  note,
  value,
  baseline,
  subscore,
  unit,
  digits = 0,
}: {
  note?: string | null;
  value?: number | null;
  baseline?: number | null;
  subscore?: number | null;
  unit?: string;
  digits?: number;
}) {
  const [open, setOpen] = useState(false);
  if (!note && value == null) return null;
  return (
    <View>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6}>
        <Text style={styles.toggle}>{open ? '> WHY ▾' : '> WHY ›'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {value != null ? (
            <Text style={styles.detail}>
              {`VALUE ${fmt(value, digits)}${unit ? ` ${unit}` : ''}`}
              {baseline != null ? `  ·  BASE ${fmt(baseline, digits)}` : ''}
              {subscore != null ? `  ·  ${Math.round(subscore * 100)}%` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1, marginTop: 2 },
  body: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    marginTop: 4,
    gap: 2,
  },
  note: { color: colors.text, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 0.5 },
  detail: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 0.5 },
});
