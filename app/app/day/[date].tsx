// unified DAY DETAIL (hidden route, reached via router.push('/day/'+date) from the
// STATUS condition block, the SLEEP "that day" panel, and the month calendar). reads
// the :date param, pulls /summary/{date}, and composes the readiness ring + our four
// explainable contributors + a vitals grid + the "> WHY?" notes — one consistent lens
// for any day, today or historical. no new endpoint: /summary/{date} already carries
// the enriched metric (explanation + temp_flag) for every stored day.
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContributorBars from '../../components/ContributorBars';
import { Panel } from '../../components/Pip';
import ReadinessRing from '../../components/ReadinessRing';
import { getSummary } from '../../lib/api';
import { cToF } from '../../lib/units';
import { colors, font, fonts, glow, scoreColor, spacing } from '../../theme';

const conditionWord = (s: number | null): string =>
  s == null ? 'NO DATA' : s >= 75 ? 'OPTIMAL' : s >= 50 ? 'FAIR' : s >= 25 ? 'STRAINED' : 'CRITICAL';

const n0 = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? '--' : String(Math.round(v));

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '--';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
};

const fmtTitle = (raw: string): string => {
  try {
    return format(parseISO(raw), 'EEE · yyyy.MM.dd').toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
};

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

export default function DayDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ date: string }>();
  const date = Array.isArray(params.date) ? params.date[0] : params.date;

  const q = useQuery({
    queryKey: ['summary', date],
    queryFn: () => getSummary(date as string),
    enabled: !!date,
  });

  // a 404 means the day simply has no stored record — retrying re-404s forever, so
  // we offer "pick another day" instead of RETRY (which is reserved for real link drops)
  const isMissing = q.isError && q.error instanceof Error && /HTTP 404/.test(q.error.message);

  const summary = q.data?.summary;
  const metric = q.data?.metric;
  const comps = metric?.components;
  const score = metric?.readiness_custom ?? null;
  const tint = scoreColor(score);
  const explanation = metric?.explanation ?? null;
  const tempFlag = metric?.temp_flag ?? null;
  const tempF = cToF(summary?.temp_mean_c);

  const Back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={styles.back}
      hitSlop={8}
    >
      <Ionicons name="chevron-back" size={18} color={colors.textDim} />
      <Text style={styles.backText}>BACK</Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      {Back}
      <Text style={styles.head}>{date ? fmtTitle(date) : 'DAY'}</Text>
      <View style={styles.headRule} />

      {q.isLoading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.text} />
          <Text style={styles.dim}>READING ARCHIVE…</Text>
        </View>
      ) : q.isError || !q.data ? (
        <View style={styles.fill}>
          <Text style={styles.dim}>NO DATA ON RECORD FOR THIS DAY</Text>
          {isMissing ? (
            <Text style={styles.dim}>PICK ANOTHER DAY FROM THE CALENDAR.</Text>
          ) : (
            <Pressable style={styles.cmd} onPress={() => q.refetch()}>
              <Text style={styles.cmdText}>{'> RETRY'}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          <View style={styles.ringWrap}>
            <ReadinessRing score={score} caption="READINESS" size={172} />
            <Text style={[styles.cond, { color: tint }, glow(tint, 8)]}>{conditionWord(score)}</Text>
            {explanation ? <Text style={styles.explain}>{explanation.toUpperCase()}</Text> : null}
          </View>

          {tempFlag?.flagged ? (
            <View style={styles.flag}>
              <Ionicons name="warning-outline" size={14} color={colors.bad} />
              <Text style={styles.flagText}>{tempFlag.note?.toUpperCase() ?? 'TEMP ANOMALY'}</Text>
            </View>
          ) : null}

          {comps ? (
            <Panel title="READINESS FACTORS">
              <ContributorBars components={comps} />
            </Panel>
          ) : null}

          <Panel title="VITALS">
            <View style={styles.metricGrid}>
              <Metric label="RESTING HR" value={n0(summary?.resting_hr)} unit="BPM" />
              <Metric label="HRV" value={n0(summary?.hrv_rmssd)} unit="MS" />
              <Metric label="SKIN TEMP" value={tempF != null ? tempF.toFixed(1) : '--'} unit="°F" />
              <Metric label="SpO2" value={n0(summary?.spo2_avg)} unit="%" />
              <Metric label="RESP" value={n0(summary?.resp_rate)} unit="BR/M" />
              <Metric label="STEPS" value={n0(summary?.steps)} />
            </View>
          </Panel>

          <Panel title="REST">
            <View style={styles.restRow}>
              <Text style={styles.restBig}>{minutesToHM(summary?.sleep_min)}</Text>
              <Text style={styles.restEff}>
                {summary?.sleep_efficiency != null ? `${Math.round(summary.sleep_efficiency)}% EFF` : '-- EFF'}
              </Text>
            </View>
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
  head: { color: colors.text, fontFamily: fonts.display, fontSize: 40, lineHeight: 44, ...glow() },
  headRule: { height: 2, backgroundColor: colors.border, marginVertical: spacing.xs },

  fill: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  dim: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, textAlign: 'center' },
  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },

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

  metricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metric: { width: '33.33%', paddingVertical: spacing.sm },
  metricValue: { color: colors.text, fontFamily: fonts.display, fontSize: 28, lineHeight: 30 },
  metricUnit: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  metricLabel: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 1, marginTop: 2 },

  restRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  restBig: { color: colors.sleep, fontFamily: fonts.display, fontSize: font.big },
  restEff: { color: colors.textDim, fontSize: font.small, letterSpacing: 1 },
});
