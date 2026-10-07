import { useUpdatesSnapshot } from '@/components/useUpdatesSnapshot';
import { MangaCard } from '@/components/MangaCard';
import { BottomSheet } from '@/components/BottomSheet';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
  const navigation = useRouter();
  const insets = useSafeAreaInsets();
  const { data, refetch } = useLibrary();
  const downloads = useDownloadedManga();
  const updates = useUpdatesSnapshot();
  const deleteDownload = useDeleteDownload();
  const params = useLocalSearchParams<{ category?: string }>();
  const [cat, setCat] = useState<CatKey>(params.category === 'downloads' ? 'downloads' : 'all');
  const [grid, setGrid] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const cols = width < 360 || fontScale > 1.2 ? 2 : 3;
  const cardWidth = (width - 32 - (cols - 1) * 12) / cols;

  useEffect(() => {
    if (params.category === 'downloads') {
      setCat('downloads');
      navigation.setParams({ category: undefined });
    }
  }, [params.category, navigation]);

  const refetchDownloads = downloads.refetch;
  useFocusEffect(
    useCallback(() => {
      refetch();
      refetchDownloads();
    }, [refetch, refetchDownloads]),
  );

  const all = useMemo(() => data ?? [], [data]);
  const list = useMemo(() => {
    const filtered = all.filter(i => matches(i, cat) && i.title.toLowerCase().includes(search.trim().toLowerCase()));
    return sort === 'title' ? filtered.sort((a, b) => a.title.localeCompare(b.title)) : filtered;
  }, [all, cat, search, sort]);
  const downloadList = useMemo(() => {
    const filtered = (downloads.data ?? []).filter(item => item.title.toLowerCase().includes(search.trim().toLowerCase()));
    return sort === 'title' ? filtered.sort((a, b) => a.title.localeCompare(b.title)) : filtered;
  }, [downloads.data, search, sort]);
  const unreadByTitle = useMemo(() => new Map(updates?.items.map(item => [item.sourceId + ':' + item.externalId, item.unread])), [updates]);
  const visibleTitleCount = cat === 'downloads' ? downloadList.length : list.length;
  const countFor = (k: CatKey) =>
    k === 'downloads'
      ? (downloads.data?.length ?? 0)
      : all.filter((i) => matches(i, k)).length;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}><Text style={styles.title}>Library</Text><View style={styles.headerTools}>
        <Pressable onPress={() => { if (searchOpen) setSearch(''); setSearchOpen(v => !v); }} style={styles.iconButton} accessibilityLabel="Search library"><Ionicons name="search-outline" size={24} color={colors.text} /></Pressable>
        <View style={styles.viewToggle}>{[true, false].map(value => <Pressable key={String(value)} onPress={() => setGrid(value)} accessibilityLabel={value ? 'Grid view' : 'List view'} accessibilityState={{ selected: grid === value }} style={[styles.iconButton, grid === value && styles.viewActive]}><Ionicons name={value ? 'grid-outline' : 'list-outline'} size={20} color={grid === value ? colors.accent : colors.textMuted} /></Pressable>)}</View>
      </View></View>
      {searchOpen && <View style={styles.searchBox}><Ionicons name="search-outline" size={18} color={colors.textMuted} /><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search your library…" placeholderTextColor={colors.textMuted} style={styles.searchInput} /><Pressable accessibilityLabel="Clear search" onPress={() => setSearch('')}><Ionicons name="close" size={20} color={colors.textMuted} /></Pressable></View>}

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
                onPress={() => { setCat(c.key); }}
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

      <View style={styles.summary}><Text style={styles.summaryText}>{visibleTitleCount} {visibleTitleCount === 1 ? 'title' : 'titles'}</Text><Pressable onPress={() => setSortOpen(true)} style={styles.sortButton}><Text style={styles.sortText}>{sort === 'recent' ? (cat === 'downloads' ? 'Recently downloaded' : 'Recently read') : 'Title A–Z'}</Text><Ionicons name="chevron-down" size={14} color={colors.textMuted} /></Pressable></View>
      {cat === 'downloads' ? (
        downloadList.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{search ? 'No matching downloads' : 'No downloads yet'}</Text>
            <Text style={styles.emptyHint}>
              Save chapters with the ⬇ button on a manga’s chapter list — they’ll read offline
              from here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={downloadList}
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
                            deleteDownload.manga.mutate(
                              {
                                sourceId: item.source_id,
                                mangaExternalId: item.manga_external_id,
                              },
                              {
                                onError: () =>
                                  Alert.alert(
                                    'Couldn’t delete',
                                    'Some files couldn’t be removed. Try again.',
                                  ),
                              },
                            ),
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
            {search ? 'No matching titles' : cat === 'all' ? 'Your library is empty' : 'Nothing here yet'}
          </Text>
          <Text style={styles.emptyHint}>
            {cat === 'all'
              ? 'Add manga from any details page.'
              : 'Set a status on a manga’s page to file it here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          key={grid ? 'grid-' + cols : 'list'}
          numColumns={grid ? cols : 1}
          columnWrapperStyle={grid ? { gap: 12, paddingHorizontal: 16 } : undefined}
          data={list}
          keyExtractor={(item) => `${item.source_id}:${item.external_id}`}
          removeClippedSubviews
          initialNumToRender={8}
          windowSize={5}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          renderItem={({ item }) => {
            if (grid) return <View style={{ marginBottom: 20 }}><MangaCard width={cardWidth} title={item.title} coverUrl={item.cover_url}
              subtitle={item.chapter_number ? 'Ch. ' + item.chapter_number + (item.percent ? ' · ' + Math.round(item.percent * 100) + '%' : '') : 'Not started'}
              progress={item.percent ?? 0}
              badge={unreadByTitle.get(item.source_id + ':' + item.external_id) ? '+' + unreadByTitle.get(item.source_id + ':' + item.external_id) : undefined}
              sourceLabel={sourceMeta(item.source_id).name} sourceColor={sourceMeta(item.source_id).color}
              onPress={() => router.push({ pathname: '/manga/[id]', params: { id: item.external_id, sourceId: item.source_id } })} /></View>;
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
                  <Text style={styles.rowPct}>{pct}% of current chapter</Text>
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
      <BottomSheet visible={sortOpen} title="Sort library" onClose={() => setSortOpen(false)}>{(['recent', 'title'] as const).map(value => <Pressable key={value} style={styles.row} onPress={() => { setSort(value); setSortOpen(false); }}><Text style={styles.sortText}>{value === 'recent' ? 'Recently read' : 'Title A–Z'}</Text>{value === sort && <Ionicons name="checkmark" size={20} color={colors.accent} />}</Pressable>)}</BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.text },
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerTools: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  viewToggle: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 3, backgroundColor: colors.bgElevated },
  viewActive: { backgroundColor: 'rgba(255,122,48,0.15)' },
  summary: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, alignItems: 'center', marginBottom: 18 },
  summaryText: { ...typography.caption, color: colors.textMuted },
  sortButton: { flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 40 },
  sortText: { ...typography.caption, fontWeight: '600', color: colors.text },
  searchBox: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, ...typography.body },

  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: 'rgba(255,122,48,0.15)' },
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
