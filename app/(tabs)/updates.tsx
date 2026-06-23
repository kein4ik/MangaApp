import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
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

export default function UpdatesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isFetching, refetch } = useUpdates();

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>Updates</Text>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
      ) : !data || data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>You’re all caught up</Text>
          <Text style={styles.emptyHint}>
            New chapters of titles you’re reading will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
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
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.metaLine}>
                  <View style={[styles.dot, { backgroundColor: sourceMeta(item.sourceId).color }]} />
                  <Text style={styles.meta}>
                    {sourceMeta(item.sourceId).name}
                    {item.latestNumber ? ` · up to ch. ${item.latestNumber}` : ''}
                  </Text>
                </View>
                <Text style={styles.unread}>
                  {item.unread} new chapter{item.unread > 1 ? 's' : ''}
                </Text>
              </View>
              {item.next && (
                <Pressable
                  style={styles.readBtn}
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
                  <Text style={styles.readBtnText}>Read ›</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.text, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { ...typography.h3, color: colors.textMuted },
  emptyHint: { ...typography.body, color: colors.textFaint, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.card },
  cover: { width: 50, height: 70, borderRadius: radius.sm, backgroundColor: colors.card },
  info: { flex: 1, gap: 3 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  meta: { ...typography.caption, color: colors.textMuted },
  unread: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  readBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  readBtnText: { ...typography.bodyStrong, color: '#1A0E06' },
});
