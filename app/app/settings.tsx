// SETTINGS: point the app at a different backend without a rebuild (TODO 4). edit
// the Pi's URL, TEST it (pings /health and times it), SAVE it (persisted + triggers
// a refetch), or RESET to the baked-in default. also a small read-only system panel.
import { useQueryClient } from '@tanstack/react-query';
import { versionLabel } from '../lib/version';
import React, { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Panel, ScreenHeader } from '../components/Pip';
import { getHealth } from '../lib/api';
import { CHARACTERS } from '../lib/characters';
import {
  DEFAULT_API_URL,
  getApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
  setCharacter,
  setSoundEnabled,
  useCharacter,
  useSoundEnabled,
} from '../lib/settings';
import { colors, font, fonts, glow, spacing } from '../theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [url, setUrl] = useState(getApiBaseUrl());
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  const character = useCharacter();
  const sound = useSoundEnabled();

  // apply the typed value to the live client (also persists it)
  const apply = async (next: string) => {
    const applied = await setApiBaseUrl(next);
    setUrl(applied);
    qc.invalidateQueries();
    return applied;
  };

  const onSave = async () => {
    await apply(url);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2000);
  };

  const onTest = async () => {
    setTesting(true);
    setSaved(false);
    setTestResult(null);
    await apply(url);
    const t0 = Date.now();
    const r = await getHealth();
    const ms = Date.now() - t0;
    setTesting(false);
    if (r.ok) {
      setTestOk(true);
      setTestResult(`LINK OK // ${ms}MS // DB ${r.data.db ? 'UP' : 'DOWN'}`);
    } else {
      setTestOk(false);
      setTestResult(`LINK FAILED // ${r.error}`);
    }
  };

  const onReset = async () => {
    const def = await resetApiBaseUrl();
    setUrl(def);
    qc.invalidateQueries();
    setTestResult(null);
    setSaved(false);
  };

  return (
    <ScrollView
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <ScreenHeader title="SET" sub="TERMINAL CONFIG" />

      <Panel title="PIP LINK">
        <Text style={styles.label}>BACKEND URL</Text>
        <View style={styles.field}>
          <Text style={styles.prompt}>{'>'}</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder={DEFAULT_API_URL}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
        </View>

        <View style={styles.btnRow}>
          <Pressable style={[styles.cmd, styles.cmdFlex]} disabled={testing} onPress={onTest}>
            <Text style={styles.cmdText}>{testing ? '> TESTING…' : '> TEST LINK'}</Text>
          </Pressable>
          <Pressable style={[styles.cmd, styles.cmdFlex]} onPress={onSave}>
            <Text style={styles.cmdText}>{'> SAVE'}</Text>
          </Pressable>
        </View>

        <Pressable style={styles.resetBtn} onPress={onReset}>
          <Text style={styles.resetText}>RESET TO DEFAULT</Text>
        </Pressable>

        {saved ? <Text style={styles.ok}>SAVED — REFETCHING</Text> : null}
        {testResult ? (
          <Text style={[styles.result, testOk ? styles.ok : styles.bad]}>{testResult}</Text>
        ) : null}
      </Panel>

      <Panel title="FIGURE">
        <Text style={styles.label}>STATUS CHARACTER</Text>
        <View style={styles.charRow}>
          {CHARACTERS.map((c) => {
            const active = c.key === character;
            return (
              <Pressable
                key={c.key}
                style={[styles.charCard, active && styles.charCardActive]}
                onPress={() => setCharacter(c.key)}
              >
                <Image source={c.source} style={styles.charThumb} resizeMode="contain" />
                <Text style={[styles.charName, active && styles.charNameActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Panel>

      <Panel title="INTERFACE">
        <Pressable style={styles.toggleRow} onPress={() => setSoundEnabled(!sound)}>
          <Text style={styles.rowLabel}>BOOT SOUND</Text>
          <View style={[styles.toggle, sound ? styles.toggleOn : styles.toggleOff]}>
            <Text style={[styles.toggleText, sound && styles.toggleTextOn]}>
              {sound ? 'ON' : 'OFF'}
            </Text>
          </View>
        </Pressable>
      </Panel>

      <Panel title="SYSTEM">
        <Row label="APP VERSION" value={versionLabel()} />
        <Row label="DEFAULT URL" value={DEFAULT_API_URL.replace(/^https?:\/\//, '')} />
        <Row label="THEME" value="GREEN PHOSPHOR" />
        <Text style={styles.note}>AMBER THEME TOGGLE — COMING SOON</Text>
      </Panel>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },

  label: { color: colors.textDim, fontSize: font.tiny, letterSpacing: 2, marginBottom: spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  prompt: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: font.body,
    paddingVertical: spacing.md,
    letterSpacing: 1,
  },

  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  cmdFlex: { flex: 1 },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },

  resetBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  resetText: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 2 },

  result: { fontSize: font.small, textAlign: 'center', marginTop: spacing.sm, letterSpacing: 1 },
  ok: { color: colors.good, fontSize: font.small, textAlign: 'center', marginTop: spacing.sm, letterSpacing: 1 },
  bad: { color: colors.bad },

  charRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  charCard: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  charCardActive: { borderColor: colors.text },
  charThumb: { width: 84, height: 108 },
  charName: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 2 },
  charNameActive: { color: colors.text, ...glow(colors.text, 8) },

  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  toggle: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
    minWidth: 70,
    alignItems: 'center',
  },
  toggleOn: { borderColor: colors.text, backgroundColor: colors.surface },
  toggleOff: { borderColor: colors.border, backgroundColor: 'transparent' },
  toggleText: { fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 2, color: colors.textFaint },
  toggleTextOn: { color: colors.text, ...glow(colors.text, 6) },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  rowLabel: { color: colors.textDim, fontSize: font.small, letterSpacing: 1 },
  rowValue: { color: colors.text, fontFamily: fonts.mono, fontSize: font.small, letterSpacing: 1, flexShrink: 1 },
  note: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1, marginTop: spacing.sm },
});
