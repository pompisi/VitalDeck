// LOG: the event-markers screen — list existing entries and add new ones (late
// caffeine, gym, alcohol…). long-press an entry to delete it. entries get
// correlated against the metrics later; for now this is capture + manage. data +
// states are unchanged from before — this is the pip-boy restyle.
import { Ionicons } from '@expo/vector-icons';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { format } from 'date-fns';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Panel, ScreenHeader } from '../components/Pip';
import { createTag, deleteTag, getTags } from '../lib/api';
import type { Tag } from '../lib/types';
import { colors, font, fonts, glow, spacing } from '../theme';

const fmtTs = (ms: number): string => {
  try {
    return format(new Date(ms), 'yyyy.MM.dd HH:mm').toUpperCase();
  } catch {
    return '';
  }
};

export default function TagsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');

  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => getTags(),
  });

  const add = useMutation({
    mutationFn: () =>
      // stamping the entry at "now" — the moment the user logs the thing
      createTag({
        ts_ms: Date.now(),
        label: label.trim(),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setLabel('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (e) => {
      Alert.alert(
        'Could not add entry',
        e instanceof Error ? e.message : 'unknown error',
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
    onError: (e) =>
      Alert.alert(
        'Could not delete entry',
        e instanceof Error ? e.message : 'unknown error',
      ),
  });

  const confirmDelete = (tag: Tag) => {
    Alert.alert('Delete entry', `Remove "${tag.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(tag.id),
      },
    ]);
  };

  const canAdd = label.trim().length > 0 && !add.isPending;

  // the entry list, rendered inside the LOG panel. branches on loading / error /
  // empty exactly as before — only the presentation changed.
  const renderList = () => {
    if (tags.isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.text} />
          <Text style={styles.dim}>READING LOG…</Text>
        </View>
      );
    }

    if (tags.isError) {
      return (
        <View style={styles.center}>
          <Text style={styles.errTitle}>LOG READ FAILURE</Text>
          <Text style={styles.dim}>
            {tags.error instanceof Error ? tags.error.message : 'unknown error'}
          </Text>
          <Pressable style={styles.cmd} onPress={() => tags.refetch()}>
            <Text style={styles.cmdText}>{'> RETRY'}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        data={tags.data?.tags ?? []}
        keyExtractor={(t) => String(t.id)}
        scrollEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={styles.empty}>NO ENTRIES LOGGED</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.entryRow}
            onLongPress={() => confirmDelete(item)}
            delayLongPress={350}
          >
            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.textDim}
              style={styles.marker}
            />
            <View style={styles.entryBody}>
              <View style={styles.entryHead}>
                <Text style={styles.entryLabel} numberOfLines={1}>
                  {item.label.toUpperCase()}
                </Text>
                <Text style={styles.entryTs}>{fmtTs(item.ts_ms)}</Text>
              </View>
              {item.note ? (
                <Text style={styles.entryNote}>{item.note}</Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    );
  };

  return (
    <FlatList
      style={styles.scroll}
      data={[]}
      renderItem={null}
      keyExtractor={() => 'x'}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.xxl,
        },
      ]}
      ListHeaderComponent={
        <View>
          <ScreenHeader title="LOG" sub="EVENT MARKERS" />

          {/* add form — a terminal input prompt */}
          <Panel title="NEW ENTRY">
            <View style={styles.field}>
              <Text style={styles.prompt}>{'>'}</Text>
              <TextInput
                style={styles.input}
                placeholder="LABEL (E.G. LATE CAFFEINE)"
                placeholderTextColor={colors.textFaint}
                value={label}
                onChangeText={setLabel}
                returnKeyType="next"
                autoCapitalize="characters"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.prompt}>{'>'}</Text>
              <TextInput
                style={styles.input}
                placeholder="NOTE (OPTIONAL)"
                placeholderTextColor={colors.textFaint}
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
                onSubmitEditing={() => canAdd && add.mutate()}
              />
            </View>
            <Pressable
              style={[styles.cmd, !canAdd && styles.cmdBusy]}
              disabled={!canAdd}
              onPress={() => add.mutate()}
            >
              <Text style={styles.cmdText}>
                {add.isPending ? '> LOGGING…' : '> ADD ENTRY'}
              </Text>
            </Pressable>
          </Panel>

          {/* the log itself */}
          <Panel title="EVENT LOG">{renderList()}</Panel>

          <Text style={styles.hint}>LONG-PRESS AN ENTRY TO PURGE IT.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },

  // terminal input prompt
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  prompt: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, ...glow() },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: font.body,
    paddingVertical: spacing.md,
    letterSpacing: 1,
  },

  // the "> COMMAND" button
  cmd: {
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cmdBusy: { opacity: 0.6, borderColor: colors.textDim },
  cmdText: { color: colors.text, fontFamily: fonts.mono, fontSize: font.body, letterSpacing: 1 },

  // log rows
  sep: { height: 1, backgroundColor: colors.border, opacity: 0.5 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  marker: { marginTop: 3 },
  entryBody: { flex: 1 },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  entryLabel: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: font.body,
    letterSpacing: 1,
    flexShrink: 1,
  },
  entryTs: { color: colors.textFaint, fontSize: font.tiny, letterSpacing: 1 },
  entryNote: { color: colors.textDim, fontSize: font.small, marginTop: 2 },

  empty: {
    color: colors.textFaint,
    fontSize: font.small,
    letterSpacing: 2,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  // shared states
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center', letterSpacing: 1 },
  errTitle: { color: colors.bad, fontFamily: fonts.display, fontSize: font.title, letterSpacing: 1 },

  hint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    letterSpacing: 1,
    paddingVertical: spacing.md,
  },
});
