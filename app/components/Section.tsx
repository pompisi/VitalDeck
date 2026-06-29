// a titled section wrapper — gives every block on a screen the same header
// treatment + spacing so the layouts read consistently
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '../theme';

interface Props {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function Section({ title, subtitle, children }: Props) {
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: font.title,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: font.small,
    marginBottom: spacing.sm,
  },
});
