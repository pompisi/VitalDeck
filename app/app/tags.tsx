// Tags: the context layer — list existing tags and add new ones (caffeine,
// gym, alcohol…). long-press a tag to delete it. tags get correlated against
// the metrics later; for now this is capture + manage.
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
import { createTag, deleteTag, getTags } from '../lib/api';
import type { Tag } from '../lib/types';
import { colors, font, radius, spacing } from '../theme';

const fmtTs = (ms: number): string => {
  try {
    return format(new Date(ms), 'MMM d, h:mm a');
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
      // stamping the tag at "now" — the moment the user logs the thing
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
        'Could not add tag',
        e instanceof Error ? e.message : 'unknown error',
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
    onError: (e) =>
      Alert.alert(
        'Could not delete tag',
        e instanceof Error ? e.message : 'unknown error',
      ),
  });

  const confirmDelete = (tag: Tag) => {
    Alert.alert('Delete tag', `Remove "${tag.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(tag.id),
      },
    ]);
  };

  const canAdd = label.trim().length > 0 && !add.isPending;

  return (
    <View style={[styles.fill, { paddingTop: spacing.lg }]}>
      {/* add form */}
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Label (e.g. late caffeine)"
          placeholderTextColor={colors.textFaint}
          value={label}
          onChangeText={setLabel}
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          placeholder="Note (optional)"
          placeholderTextColor={colors.textFaint}
          value={note}
          onChangeText={setNote}
          returnKeyType="done"
          onSubmitEditing={() => canAdd && add.mutate()}
        />
        <Pressable
          style={[styles.addBtn, !canAdd && styles.addBtnDisabled]}
          disabled={!canAdd}
          onPress={() => add.mutate()}
        >
          {add.isPending ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.addText}>Add tag</Text>
          )}
        </Pressable>
      </View>

      {/* list */}
      {tags.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tags.isError ? (
        <View style={styles.center}>
          <Text style={styles.errTitle}>Couldn't load tags</Text>
          <Text style={styles.dim}>
            {tags.error instanceof Error ? tags.error.message : 'unknown error'}
          </Text>
          <Pressable style={styles.retryBtn} onPress={() => tags.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={tags.data?.tags ?? []}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + spacing.xxl },
          ]}
          ListEmptyComponent={
            <Text style={[styles.dim, { marginTop: spacing.xl }]}>
              No tags yet — log your first one above.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.tagRow}
              onLongPress={() => confirmDelete(item)}
              delayLongPress={350}
            >
              <View style={styles.tagDot} />
              <View style={styles.tagBody}>
                <Text style={styles.tagLabel}>{item.label}</Text>
                {item.note ? (
                  <Text style={styles.tagNote}>{item.note}</Text>
                ) : null}
              </View>
              <Text style={styles.tagTs}>{fmtTs(item.ts_ms)}</Text>
            </Pressable>
          )}
        />
      )}
      <Text style={styles.hint}>Long-press a tag to delete it.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  form: { gap: spacing.md, marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: font.body,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.45 },
  addText: { color: colors.bg, fontSize: font.body, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  dim: { color: colors.textDim, fontSize: font.small, textAlign: 'center' },
  errTitle: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  retryText: { color: colors.accent, fontWeight: '700' },
  list: { gap: spacing.sm },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  tagDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  tagBody: { flex: 1 },
  tagLabel: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  tagNote: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  tagTs: { color: colors.textFaint, fontSize: font.tiny },
  hint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
