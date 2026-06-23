import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLibrary } from '@/data/queries';
import { imageSource } from '@/lib/imageSource';
import { sourceMeta } from '@/lib/sourceMeta';
import { timeAgo } from '@/lib/time';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

type Tab = 'recent' | 'favourites' | 'downloads';

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, refetch } = useLibrary();
  const [tab, setTab] = useState<Tab>('recent');

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const all = data ?? [];
  const favourites = useMemo(() => all.filter((i) => i.favorite === 1), [all]);
  const list = tab === 'favourites' ? favourites : all;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>My Library</Text>

      <View style={styles.tabs}>
        <Tab label="Recent" count={all.length} active={tab === 'recent'} onPress={() => setTab('recent')} />
        <Tab
          label="Favourites"
          count={favourites.length}
          active={tab === 'favourites'}
          onPress={() => setTab('favourites')}
        />
        <Tab label="Downloads" count={0} active={tab === 'downloads'} onPress={() => setTab('downloads')} />
      </View>

      {tab === 'downloads' ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Downloads</Text>
          <Text style={styles.emptyHint}>Offline downloads are coming soon.</Text>
        </View>
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {tab === 'favourites' ? 'No favourites yet' : 'Your library is empty'}
          </Text>
          <Text style={styles.emptyHint}>
            {tab === 'favourites'
              ? 'Tap ♡ on any manga to add it here.'
              : 'Add manga from any details page.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => `${item.source_id}:${item.external_id}`}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
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
                <Image
                  source={imageSource(item.cover_url)}
                  style={styles.cover}
                  contentFit="cover"
                />
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

function Tab({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
        {count > 0 ? ` (${count})` : ''}
      </Text>
      {active && <View style={styles.tabUnderline} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.text, paddingHorizontal: spacing.lg },

  tabs: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: { paddingBottom: spacing.sm },
  tabText: { ...typography.bodyStrong, color: colors.textFaint },
  tabTextActive: { color: colors.text },
  tabUnderline: {
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },

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
