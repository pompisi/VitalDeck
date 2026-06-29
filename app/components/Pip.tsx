// shared pip-boy UI primitives so every screen reads the same: the big VT323
// header + rule, bracketed terminal panels, and segmented phosphor meters.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, fonts, glow, spacing } from '../theme';

// the screen header: big display title, optional right-aligned timestamp, a rule,
// and an optional sub-line. matches the STATUS screen.
export function ScreenHeader({
  title,
  sub,
  asOf,
}: {
  title: string;
  sub?: string;
  asOf?: string;
}) {
  return (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.head}>{title}</Text>
        {asOf ? <Text style={styles.headAsOf}>{asOf}</Text> : null}
      </View>
      <View style={styles.headRule} />
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

// a bracketed terminal panel with a header label sitting on the top rule
export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      {title ? (
        <View style={styles.panelHead}>
          <Text style={styles.panelTitle}>{title}</Text>
          <View style={styles.panelRule} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

// a segmented phosphor meter; value clamps 0..1
export function Bar({ value, color }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color ?? colors.text }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  head: { color: colors.text, fontFamily: fonts.display, fontSize: 44, lineHeight: 46, ...glow() },
  headAsOf: { color: colors.textDim, fontSize: font.tiny, marginBottom: 6, letterSpacing: 1 },
  headRule: { height: 2, backgroundColor: colors.border, marginVertical: spacing.xs },
  sub: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 2, marginBottom: spacing.md },

  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  panelHead: { marginBottom: spacing.sm },
  panelTitle: { color: colors.textDim, fontSize: font.small, letterSpacing: 2 },
  panelRule: { height: 1, backgroundColor: colors.border, marginTop: spacing.xs },

  barTrack: {
    height: 14,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  barFill: { height: '100%' },
});
