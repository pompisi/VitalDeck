// STATUS: the pip-boy-style home screen. a header rule, the original operative
// figure with vitals pinned around it, an HP-style CONDITION bar, a readiness-
// factors panel, last rest, and a terminal-style sync command. data + states are
// unchanged from before — this is the restyle.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LiveBadge from '../components/LiveBadge';
import StatusFigure from '../components/StatusFigure';
import Ticker from '../components/Ticker';
import { getLive, getToday, postSync } from '../lib/api';
import { getApiBaseUrl } from '../lib/settings';
import { cToF } from '../lib/units';
import type { ReadinessComponent, StageBreakdown } from '../lib/types';
import { colors, font, fonts, glow, radius, scoreColor, spacing } from '../theme';

// the data timestamp (when the latest reading is from) — shown in the ticker.
const fmtAsOf = (ms: number | null | undefined): string => {
  if (ms == null) return 'NO SIGNAL';
  try {
    return format(new Date(ms), 'yyyy.MM.dd h:mm a').toUpperCase();
  } catch {
    return 'UNKNOWN';
  }
};

// the live wall clock shown in the header — device-local, 12-hour with AM/PM.
const fmtClock = (ms: number): string => {
  try {
    return format(new Date(ms), 'yyyy.MM.dd  h:mm a').toUpperCase();
  } catch {
    return '';
  }
};

const minutesToHM = (min: number | null | undefined): string => {
  if (min == null || Number.isNaN(min)) return '--';
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
};

const conditionWord = (score: number | null | undefined): string => {
  if (score == null || Number.isNaN(score)) return 'NO DATA';
  if (score >= 75) return 'OPTIMAL';
  if (score >= 50) return 'FAIR';
  if (score >= 25) return 'STRAINED';
  return 'CRITICAL';
};

const parseStages = (raw: StageBreakdown | string | null | undefined): StageBreakdown => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as StageBreakdown;
    } catch {
      return {};
    }
  }
  return raw;
};

// a segmented phosphor meter; fill clamps 0..1
function Bar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

// a bracketed terminal panel with a header label sitting on the top rule
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle}>{title}</Text>
        <View style={styles.panelRule} />
      </View>
      {children}
    </View>
  );
}

function FactorRow({ label, comp }: { label: string; comp: ReadinessComponent | undefined }) {
  const pct = comp ? Math.round(comp.subscore * 100) : null;
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel}>{label}</Text>
      <View style={styles.factorBar}>
        <Bar value={(pct ?? 0) / 100} color={scoreColor(pct)} />
      </View>
      <Text style={styles.factorPct}>{pct != null ? String(pct).padStart(3, ' ') : '---'}</Text>
    </View>
  );
}

export default function StatusScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const today = useQuery({ queryKey: ['summary', 'today'], queryFn: getToday });
  const sync = useMutation({ mutationFn: postSync, onSuccess: () => qc.invalidateQueries() });

  // a live clock for the header, ticking every 30s (kept in sync with the device)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // live-ish current heart rate: polled from the Oura cloud every 60s (and on
  // focus / when SYNC is pressed). the only intraday metric the cloud exposes.
  const live = useQuery({
    queryKey: ['live'],
    queryFn: getLive,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  });

  const SyncButton = (
    <Pressable
      style={[styles.cmd, sync.isPending && styles.cmdBusy]}
      disabled={sync.isPending}
      onPress={() => {
        sync.mutate();
        live.refetch();
      }}
    >
      <Text style={styles.cmdText}>{sync.isPending ? '> SYNCING SENSORS…' : '> SYNC SENSORS'}</Text>
    </Pressable>
  );

  if (today.isLoading) {
    return (
      <View style={styles.fill}>
        <ActivityIndicator color={colors.text} />
        <Text style={styles.dim}>READING SENSORS…</Text>
      </View>
    );
  }

  const isEmpty =
    today.isError && today.error instanceof Error && /HTTP 404/.test(today.error.message);

  if (isEmpty) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>NO DATA ON RECORD</Text>
        <Text style={styles.dim}>Run a sync to pull your first day.</Text>
        {SyncButton}
        {sync.isError ? <Text style={styles.err}>SYNC FAILED</Text> : null}
      </View>
    );
  }

  if (today.isError || !today.data) {
    return (
      <View style={styles.fill}>
        <Text style={styles.errTitle}>NO LINK TO PIP</Text>
        <Text style={styles.dim}>
          {today.error instanceof Error ? today.error.message : 'unknown error'}
        </Text>
        <Pressable style={styles.cmd} onPress={() => today.refetch()}>
          <Text style={styles.cmdText}>{'> RETRY'}</Text>
        </Pressable>
      </View>
    );
  }

  const { summary, metric, data_as_of } = today.data;
  const stages = parseStages(summary?.stage_breakdown_json);
  const comps = metric?.components;
  const score = metric?.readiness_custom ?? null;
  const tint = scoreColor(score);

  // live HR (from the /live poll) drives the HEART readout when fresh (< 30 min old);
  // otherwise we fall back to last night's resting HR.
  const liveBpm = live.data?.ok ? live.data.bpm : null;
  const liveFresh =
    liveBpm != null &&
    live.data?.ts_ms != null &&
    Date.now() - live.data.ts_ms < 30 * 60 * 1000;
  const heartHr = liveBpm ?? summary?.resting_hr;

  const n0 = (v: number | null | undefined): string =>
    v == null || Number.isNaN(v) ? '--' : String(Math.round(v));
  const tempF = cToF(summary?.temp_mean_c);
  const tickerItems = [
    `READINESS ${score != null ? Math.round(score) : '--'}`,
    `HR ${liveBpm != null ? liveBpm : '--'} BPM`,
    `HRV ${n0(summary?.hrv_rmssd)} MS`,
    `RHR ${n0(summary?.resting_hr)} BPM`,
    `SKIN ${tempF != null ? tempF.toFixed(1) : '--'} °F`,
    `SpO2 ${n0(summary?.spo2_avg)} %`,
    `LINK ${getApiBaseUrl().replace(/^https?:\/\//, '')}`,
    `LAST SYNC ${fmtAsOf(data_as_of)}`,
  ];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      {/* header rule */}
      <View style={styles.headRow}>
        <Text style={styles.head}>STATUS</Text>
        <Text style={styles.headAsOf}>{fmtClock(now)}</Text>
      </View>
      <View style={styles.headRule} />
      <Text style={styles.sub}>VITAL SIGNS // VAULT-DWELLER</Text>

      <StatusFigure
        readiness={score}
        hr={heartHr}
        hrv={summary?.hrv_rmssd}
        temp={summary?.temp_mean_c}
        spo2={summary?.spo2_avg}
      />

      <LiveBadge
        fresh={liveFresh}
        tsMs={live.data?.ts_ms}
        dayMin={live.data?.day_min}
        dayMax={live.data?.day_max}
      />

      <Ticker items={tickerItems} />

      {/* HP-style condition bar */}
      <View style={styles.condRow}>
        <Text style={styles.condLabel}>CONDITION</Text>
        <Text style={[styles.condScore, { color: tint }, glow(tint, 10)]}>
          {score != null ? Math.round(score) : '--'}
        </Text>
        <Text style={[styles.condWord, { color: tint }]}>{conditionWord(score)}</Text>
      </View>
      <Bar value={(score ?? 0) / 100} color={tint} />

      {comps ? (
        <Panel title="READINESS FACTORS">
          <FactorRow label="HRV" comp={comps.hrv} />
          <FactorRow label="RESTING HR" comp={comps.resting_hr} />
          <FactorRow label="SKIN TEMP" comp={comps.temp} />
          <FactorRow label="SLEEP" comp={comps.sleep} />
        </Panel>
      ) : null}

      <Panel title="LAST REST CYCLE">
        <View style={styles.restRow}>
          <Text style={styles.restBig}>{minutesToHM(summary?.sleep_min)}</Text>
          <Text style={styles.restEff}>
            {summary?.sleep_efficiency != null
              ? `${Math.round(summary.sleep_efficiency)}% EFF`
              : '-- EFF'}
          </Text>
        </View>
        <View style={styles.restStages}>
          <Text style={styles.restStage}>DEEP {Math.round(stages.deep_min ?? 0)}</Text>
          <Text style={styles.restStage}>REM {Math.round(stages.rem_min ?? 0)}</Text>
          <Text style={styles.restStage}>LIGHT {Math.round(stages.light_min ?? 0)}</Text>
          <Text style={styles.restStage}>AWAKE {Math.round(stages.awake_min ?? 0)}</Text>
        </View>
      </Panel>

      {SyncButton}
      {sync.isError ? <Text style={styles.err}>SYNC FAILED</Text> : null}
      {sync.isSuccess ? (
        <Text style={styles.ok}>
          {sync.data.mode === 'synthetic'
            ? `SIM DAY GENERATED (+${sync.data.ingested})`
            : sync.data.mode === 'oura'
              ? `SYNCED — ${sync.data.ingested} DAYS REFRESHED FROM OURA`
              : `SYNCED (+${sync.data.ingested} NEW / ${sync.data.deduped} DUP)`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  fill: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center', letterSpacing: 1 },
  err: { color: colors.bad, fontSize: font.small, textAlign: 'center', marginTop: spacing.sm },
  ok: { color: colors.good, fontSize: font.small, textAlign: 'center', marginTop: spacing.sm },
  errTitle: { color: colors.text, fontFamily: fonts.display, fontSize: font.title },

  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  head: { color: colors.text, fontFamily: fonts.display, fontSize: 44, lineHeight: 46, ...glow() },
  headAsOf: { color: colors.textDim, fontSize: font.tiny, marginBottom: 6, letterSpacing: 1 },
  headRule: { height: 2, backgroundColor: colors.border, marginVertical: spacing.xs },
  sub: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 2, marginBottom: spacing.md },

  condRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, marginTop: spacing.lg },
  condLabel: { color: colors.textDim, fontSize: font.small, letterSpacing: 1, flex: 1 },
  condScore: { fontFamily: fonts.display, fontSize: 48, lineHeight: 50 },
  condWord: { fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },

  barTrack: {
    height: 14,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
    padding: 2,
  },
  barFill: { height: '100%' },

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

  factorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: 5 },
  factorLabel: { color: colors.textDim, fontSize: font.small, width: 92 },
  factorBar: { flex: 1 },
  factorPct: { color: colors.text, fontSize: font.small, width: 36, textAlign: 'right' },

  restRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  restBig: { color: colors.text, fontFamily: fonts.display, fontSize: font.big },
  restEff: { color: colors.textDim, fontSize: font.small, letterSpacing: 1 },
  restStages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  restStage: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1 },

  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  cmdBusy: { opacity: 0.6, borderColor: colors.textDim },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },
});
