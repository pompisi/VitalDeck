// the STATUS centerpiece: the phosphor figure the user picked in settings (the
// "player toggle"), with the live vitals pinned around it (HEART/TEMP left, HRV/SpO2
// right). static — no pulsing. temp is shown in Fahrenheit. art is a baked
// phosphor-green PNG on a real transparent background (see lib/characters).
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { characterSource } from '../lib/characters';
import { useCharacter } from '../lib/settings';
import { cToF } from '../lib/units';
import { colors, font, fonts } from '../theme';

const fmt = (v: number | null | undefined, digits = 0): string => {
  if (v == null || Number.isNaN(v)) return '--';
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
};

function Callout({
  label, value, unit, digits = 0, side,
}: {
  label: string; value: number | null | undefined; unit: string; digits?: number; side: 'left' | 'right';
}) {
  const dash = <View style={styles.dash} />;
  return (
    <View style={[styles.callout, side === 'left' ? styles.alignR : styles.alignL]}>
      <Text style={styles.calLabel}>{label}</Text>
      <View style={styles.calValueRow}>
        {side === 'right' ? dash : null}
        <Text style={styles.calValue}>{fmt(value, digits)}</Text>
        {side === 'left' ? dash : null}
      </View>
      <Text style={styles.calUnit}>{unit}</Text>
    </View>
  );
}

export default function StatusFigure({
  hr, hrv, temp, spo2,
}: {
  readiness?: number | null | undefined; // kept for call-site compatibility
  hr: number | null | undefined;
  hrv: number | null | undefined;
  temp: number | null | undefined;
  spo2: number | null | undefined;
}) {
  const character = useCharacter();
  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <Callout label="HEART" value={hr} unit="BPM" side="left" />
        <Callout label="TEMP" value={cToF(temp)} unit="°F" digits={1} side="left" />
      </View>

      <Image source={characterSource(character)} resizeMode="contain" style={styles.figure} />

      <View style={styles.col}>
        <Callout label="HRV" value={hrv} unit="MS" side="right" />
        <Callout label="SpO2" value={spo2} unit="%" side="right" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  col: { flex: 1, justifyContent: 'space-around', height: 190, gap: 28 },
  figure: { width: 140, height: 188 },
  callout: {},
  alignL: { alignItems: 'flex-start' },
  alignR: { alignItems: 'flex-end' },
  calLabel: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  calValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calValue: { color: colors.text, fontFamily: fonts.display, fontSize: 34, lineHeight: 36 },
  calUnit: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  dash: { width: 16, height: 2, backgroundColor: colors.textDim },
});
