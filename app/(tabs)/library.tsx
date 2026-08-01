import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDeleteDownload, useDownloadedManga, useLibrary } from '@/data/queries';
import type { LibraryRow } from '@/data/local/db';
import { fmtBytes } from '@/lib/format';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { imageSource } from '@/lib/imageSource';
import { sourceMeta } from '@/lib/sourceMeta';
import { timeAgo } from '@/lib/time';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'reading', label: 'Reading' },
  { key: 'plan', label: 'Plan to read' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'downloads', label: 'Downloads' },
] as const;
type CatKey = (typeof CATEGORIES)[number]['key'];

function matches(item: LibraryRow, cat: CatKey): boolean {
  if (cat === 'all' || cat === 'downloads') return true;
  if (cat === 'favourites') return item.favorite === 1;
  return item.status === cat;
}

export default function LibraryScreen() {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const { data, refetch } = useLibrary();
  const downloads = useDownloadedManga();
  const deleteDownload = useDeleteDownload();
  const [cat, setCat] = useState<CatKey>('all');

  const refetchDownloads = downloads.refetch;
  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchDownloads();
    }, [refetch, refetchDownloads]),
  );

  const all = useMemo(() => data ?? [], [data]);
  const list = useMemo(() => all.filter((i) => matches(i, cat)), [all, cat]);
  const countFor = (k: CatKey) =>
    k === 'downloads'
      ? (downloads.data?.length ?? 0)
      : all.filter((i) => matches(i, k)).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>My Library</Text>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {CATEGORIES.map((c) => {
            const active = c.key === cat;
            const n = countFor(c.key);
            return (
              <Pressable
                key={c.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setCat(c.key)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                  {n > 0 ? ` ${n}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {cat === 'downloads' ? (
        (downloads.data?.length ?? 0) === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No downloads yet</Text>
            <Text style={styles.emptyHint}>
              Save chapters with the ⬇ button on a manga’s chapter list — they’ll read offline
              from here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={downloads.data}
            keyExtractor={(item) => `${item.source_id}:${item.manga_external_id}`}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() =>
                  router.push({
                    pathname: '/manga/[id]',
                    params: { id: item.manga_external_id, sourceId: item.source_id },
                  })
                }
              >
                <Image source={imageSource(item.cover_url)} style={styles.cover} contentFit="cover" />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.rowMetaLine}>
                    <View
                      style={[styles.srcDot, { backgroundColor: sourceMeta(item.source_id).color }]}
                    />
                    <Text style={styles.rowChapter}>{sourceMeta(item.source_id).name}</Text>
                  </View>
                  <Text style={styles.rowPct}>
                    {item.chapters} chapter{item.chapters > 1 ? 's' : ''} · {fmtBytes(item.bytes)} · offline
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() =>
                    Alert.alert(
                      'Delete downloads?',
                      `All ${item.chapters} downloaded chapter${item.chapters > 1 ? 's' : ''} of “${item.title}” will be removed from the device.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () =>
                            deleteDownload.manga.mutate({
                              sourceId: item.source_id,
                              mangaExternalId: item.manga_external_id,
                            }),
                        },
                      ],
                    )
                  }
                >
                  <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
                </Pressable>
              </Pressable>
            )}
          />
        )
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {cat === 'all' ? 'Your library is empty' : 'Nothing here yet'}
          </Text>
          <Text style={styles.emptyHint}>
            {cat === 'all'
              ? 'Add manga from any details page.'
              : 'Set a status on a manga’s page to file it here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => `${item.source_id}:${item.external_id}`}
          removeClippedSubviews
          initialNumToRender={8}
          windowSize={5}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          renderItem={({ item }) => {
            const pct = Math.round((item.percent ?? 0) * 100);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() =>
                  router.push({
                    pathname: '/manga/[id]',
                    params: { id: item.external_id, sourceId: item.source_id },
                  })
                }
              >
                <Image source={imageSource(item.cover_url)} style={styles.cover} contentFit="cover" />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.rowMetaLine}>
                    <View style={[styles.srcDot, { backgroundColor: sourceMeta(item.source_id).color }]} />
                    <Text style={styles.rowChapter}>
                      {item.chapter_number ? `Chapter ${item.chapter_number}` : 'Not started'}
                    </Text>
                  </View>
                  <Text style={styles.rowPct}>{pct}% read</Text>
                  {item.last_read_at ? (
                    <Text style={styles.rowAgo}>Last read {timeAgo(item.last_read_at)}</Text>
                  ) : null}
                </View>
                {item.favorite === 1 && <Text style={styles.heart}>♥</Text>}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.text, paddingHorizontal: spacing.lg },

  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.accentMuted },
  chipText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: colors.accent },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.card },
  cover: { width: 56, height: 78, borderRadius: radius.sm, backgroundColor: colors.card },
  rowInfo: { flex: 1, gap: 3 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  srcDot: { width: 7, height: 7, borderRadius: radius.pill },
  rowChapter: { ...typography.caption, color: colors.accent },
  rowPct: { ...typography.caption, color: colors.textMuted },
  rowAgo: { ...typography.tiny, color: colors.textFaint },
  heart: { color: colors.accent, fontSize: 16 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyText: { ...typography.h3, color: colors.textMuted },
  emptyHint: { ...typography.body, color: colors.textFaint, textAlign: 'center' },
});
