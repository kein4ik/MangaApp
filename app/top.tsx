import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MangaCard } from '@/components/MangaCard';
import { SourceLangBar } from '@/components/SourceLangBar';
import { useTrending } from '@/data/queries';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const COLS = 3;
const GAP = spacing.md;
type Sort = 'popular' | 'latest';

export default function TopScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sort?: string }>();
  const { selectedSourceId, language } = useSettings();
  const [sort, setSort] = useState<Sort>(params.sort === 'latest' ? 'latest' : 'popular');

  const { data, isLoading, isError, refetch } = useTrending(selectedSourceId, language, sort, 48);

  const cardWidth =
    (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLS - 1)) / COLS;

  return (
    <>
      <Stack.Screen options={{ title: 'Top mangas' }} />
      <View style={styles.screen}>
        <SourceLangBar />

        <View style={styles.sortRow}>
          {(['popular', 'latest'] as Sort[]).map((s) => (
            <Pressable
              key={s}
              style={[styles.sortChip, sort === s && styles.sortChipActive]}
              onPress={() => setSort(s)}
            >
              <Text style={[styles.sortText, sort === s && styles.sortTextActive]}>
                {s === 'popular' ? '🔥 Popular' : '🆕 Latest'}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.srcHint}>from {sourceMeta(selectedSourceId).name}</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <View style={styles.center}>
            <Text style={styles.errText}>
              {sourceMeta(selectedSourceId).name} is unavailable right now.
            </Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.externalId}
            numColumns={COLS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: insets.bottom + spacing.xxl,
              gap: GAP,
            }}
            renderItem={({ item, index }) => (
              <View>
                <MangaCard
                  width={cardWidth}
                  title={item.title}
                  coverUrl={item.coverUrl}
                  onPress={() =>
                    router.push({
                      pathname: '/manga/[id]',
                      params: { id: item.externalId, sourceId: item.sourceId },
                    })
                  }
                />
                {sort === 'popular' && index < 3 && (
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>
                )}
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.sm },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sortChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  sortChipActive: { backgroundColor: colors.accentMuted },
  sortText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  sortTextActive: { color: colors.accent },
  srcHint: { ...typography.caption, color: colors.textFaint, marginLeft: 'auto' },

  rankBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...typography.tiny, color: '#1A0E06', fontWeight: '800' },

  center: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl, gap: spacing.md },
  errText: { ...typography.body, color: colors.textMuted },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  retryText: { ...typography.bodyStrong, color: '#1A0E06' },
});
