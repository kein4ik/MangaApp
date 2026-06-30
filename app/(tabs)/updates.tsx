import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdates } from '@/data/queries';
import { imageSource } from '@/lib/imageSource';
import { sourceMeta } from '@/lib/sourceMeta';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

type Filter = 'all' | 'en' | 'ru';

export default function UpdatesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isFetching, refetch } = useUpdates();
  const [filter, setFilter] = useState<Filter>('all');

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const items = useMemo(() => {
    if (!data || filter === 'all') return data ?? [];
    return data.filter((item) =>
      filter === 'ru' ? item.language === 'ru' : item.language !== 'ru',
    );
  }, [data, filter]);

  const unreadTotal = items.reduce((total, item) => total + item.unread, 0);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Updates</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Refresh updates"
            hitSlop={10}
            style={styles.headerIcon}
            onPress={() => refetch()}
          >
            <Ionicons name="refresh-outline" size={21} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityLabel="Source diagnostics"
            hitSlop={10}
            style={styles.headerIcon}
            onPress={() => router.push('/diagnostics')}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.segment}>
        {([
          ['all', 'All'],
          ['en', 'English'],
          ['ru', 'Russian'],
        ] as const).map(([value, label]) => {
          const active = filter === value;
          return (
            <Pressable
              key={value}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setFilter(value)}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          Unread <Text style={styles.summaryCount}>{unreadTotal}</Text>
        </Text>
        <Text style={styles.sortText}>Most unread</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
      ) : !data || data.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={44} color={colors.textFaint} />
          <Text style={styles.emptyText}>You’re all caught up</Text>
          <Text style={styles.emptyHint}>
            New chapters of titles you’re reading will show up here.
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="language-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>Nothing in this language</Text>
          <Text style={styles.emptyHint}>Try another filter or pull down to refresh.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.sourceId}:${item.externalId}`}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() =>
                router.push({
                  pathname: '/manga/[id]',
                  params: { id: item.externalId, sourceId: item.sourceId },
                })
              }
            >
              <Image source={imageSource(item.coverUrl)} style={styles.cover} contentFit="cover" />
              <View style={styles.info}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.sourceLine}>
                  <View style={[styles.dot, { backgroundColor: sourceMeta(item.sourceId).color }]} />
                  <Text style={styles.source}>{sourceMeta(item.sourceId).name}</Text>
                </View>
                <Text style={styles.chapterMeta} numberOfLines={1}>
                  {item.latestNumber ? `Ch. ${item.latestNumber}` : 'New chapter'}
                  {'  ·  '}
                  {item.unread} unread
                </Text>
              </View>
              {item.next ? (
                <Pressable
                  accessibilityLabel={`Read next chapter of ${item.title}`}
                  style={styles.unreadBadge}
                  onPress={() =>
                    router.push({
                      pathname: '/reader/[chapterId]',
                      params: {
                        chapterId: item.next!.id,
                        sourceId: item.sourceId,
                        mangaId: item.externalId,
                        chapterNumber: item.next!.number ?? '',
                        lang: item.language,
                        startPage: '0',
                      },
                    })
                  }
                >
                  <Text style={styles.unreadBadgeText}>{item.unread}</Text>
                </Pressable>
              ) : null}
              <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    padding: 3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  segmentItem: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentItemActive: { backgroundColor: colors.accentMuted },
  segmentText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: colors.accent },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  summaryText: { ...typography.bodyStrong, color: colors.text },
  summaryCount: { color: colors.accent },
  sortText: { ...typography.caption, color: colors.textFaint },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: { ...typography.h3, color: colors.textMuted },
  emptyHint: { ...typography.body, color: colors.textFaint, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 94,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.card },
  cover: {
    width: 54,
    height: 76,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  info: { flex: 1, gap: 3 },
  rowTitle: { ...typography.bodyStrong, color: colors.text, lineHeight: 19 },
  sourceLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  source: { ...typography.caption, color: colors.textMuted },
  chapterMeta: { ...typography.caption, color: colors.textFaint },
  unreadBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: { ...typography.caption, color: '#1A0E06', fontWeight: '800' },
});
