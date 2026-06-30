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
import ContributorBars from '../components/ContributorBars';
import { Panel } from '../components/Pip';
import ReadinessRing from '../components/ReadinessRing';
import { getToday } from '../lib/api';
import { colors, font, fonts, glow, scoreColor, spacing } from '../theme';

const conditionWord = (s: number | null): string =>
  s == null ? 'NO DATA' : s >= 75 ? 'OPTIMAL' : s >= 50 ? 'FAIR' : s >= 25 ? 'STRAINED' : 'CRITICAL';

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
            <ContributorBars components={comps} />
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
});
