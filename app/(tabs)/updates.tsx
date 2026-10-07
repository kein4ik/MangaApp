import { UpdateMangaCard } from '@/components/UpdateMangaCard';
import type { Chapter } from '@/data/sources/types';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  SectionList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListSkeleton } from '@/components/Skeleton';
import { refreshUpdates, useUpdates } from '@/data/queries';
import { timeAgo } from '@/lib/time';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

type Filter = 'all' | 'en' | 'ru';

export default function UpdatesScreen() {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, dataUpdatedAt, isLoading, isError, isRefetchError, isFetching, refetch } =
    useUpdates();
  const [filter, setFilter] = useState<Filter>('all');

  // Coming back to the tab recounts from cached chapter lists (cheap)...
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );
  // ...while pull-to-refresh / the button really re-check every source.
  const refreshNow = useCallback(() => {
    refreshUpdates(qc);
  }, [qc]);

  const allItems = useMemo(() => data?.items ?? [], [data]);
  const failed = data?.failed ?? [];
  const items = useMemo(() => {
    if (filter === 'all') return allItems;
    return allItems.filter((item) =>
      filter === 'ru' ? item.language === 'ru' : item.language !== 'ru',
    );
  }, [allItems, filter]);

  const unreadTotal = items.reduce((total, item) => total + item.unread, 0);

  const groups = new Map<string, typeof items>();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  for (const item of items) {
    const cached = qc.getQueryData<Chapter[]>(['chapters', item.sourceId, item.externalId, item.language]);
    const chapter = cached?.find(c => c.chapterNumber === item.latestNumber);
    const date = chapter?.publishedAt ? Date.parse(chapter.publishedAt) : NaN;
    const label = Number.isNaN(date) ? 'New chapters' : date >= today.getTime() ? 'Today' : date >= yesterday.getTime() ? 'Yesterday' : 'Earlier';
    const group = groups.get(label) ?? []; group.push(item); groups.set(label, group);
  }
  const sections = ['Today', 'Yesterday', 'Earlier', 'New chapters'].filter(title => groups.has(title)).map(title => ({ title, data: groups.get(title)! }));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.title}>Updates</Text><Text style={styles.subtitle}>{unreadTotal} unread chapters{dataUpdatedAt ? ' · checked ' + timeAgo(dataUpdatedAt) : ''}</Text></View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Refresh updates"
            hitSlop={10}
            style={styles.headerIcon}
            onPress={refreshNow}
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

      {/* A failed re-check keeps the last result on screen — say it's old, or
          "all caught up" would be a claim nobody checked. */}
      {isRefetchError && allItems.length > 0 ? (
        <Pressable style={styles.failedNote} onPress={refreshNow}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text style={styles.failedNoteText} numberOfLines={2}>
            Couldn’t check for new chapters — showing the last check ({timeAgo(dataUpdatedAt)}).
            Tap to retry.
          </Text>
        </Pressable>
      ) : failed.length > 0 && (
        <Pressable style={styles.failedNote} onPress={refreshNow}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.failedNoteText} numberOfLines={2}>
            Couldn’t check {failed.length} title{failed.length > 1 ? 's' : ''} (
            {failed
              .slice(0, 2)
              .map((f) => f.title)
              .join(', ')}
            {failed.length > 2 ? '…' : ''}) — source unavailable. Tap to retry.
          </Text>
        </Pressable>
      )}

      {isLoading ? (
        <ListSkeleton />
      ) : isError && allItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textFaint} />
          <Text style={styles.emptyText}>Couldn’t check for updates</Text>
          <Text style={styles.emptyHint}>No source answered. Check your connection and retry.</Text>
          <Pressable style={styles.retryBtn} onPress={refreshNow}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : allItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle-outline" size={44} color={colors.textFaint} />
          <Text style={styles.emptyText}>
            {failed.length > 0 ? 'Nothing new among the titles checked' : 'You’re all caught up'}
          </Text>
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
        <SectionList
          sections={sections}
          keyExtractor={item => item.sourceId + ':' + item.externalId}
          stickySectionHeadersEnabled={false}
          initialNumToRender={5} windowSize={5}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refreshNow} tintColor={colors.accent} />}
          renderSectionHeader={({ section }) => <Text style={styles.groupHeading}>{section.title}</Text>}
          renderItem={({ item }) => <UpdateMangaCard item={item} />}
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
  title: { ...typography.h1, fontSize: 30, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
  groupHeading: { ...typography.caption, color: colors.textMuted, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
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
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentItemActive: { backgroundColor: 'rgba(255,122,48,0.16)' },
  segmentText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: colors.accent },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyText: { ...typography.h3, color: colors.textMuted },
  emptyHint: { ...typography.body, color: colors.textFaint, textAlign: 'center' },
  failedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#272113', borderWidth: 1, borderColor: '#463915', marginTop: 14,
  },
  failedNoteText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  retryText: { ...typography.bodyStrong, color: '#1A0E06' },
});
