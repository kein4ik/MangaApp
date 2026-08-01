import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MangaCard } from '@/components/MangaCard';
import { useBrowseGenreAll } from '@/data/queries';
import { sourceMeta } from '@/lib/sourceMeta';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const COLS = 3;
const GAP = spacing.md;

/**
 * Genre browse across every enabled genre-capable source. Follows the same
 * language rule as search: only sources serving an enabled content language
 * take part, and the genre name is translated per source (EN↔RU).
 */
export default function BrowseScreen() {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ genre?: string }>();
  const genre = params.genre ?? '';
  const { enabledLanguages, hiddenSources } = useSettings();

  const { data, isLoading, isError, refetch } = useBrowseGenreAll(
    genre,
    enabledLanguages,
    hiddenSources,
  );

  const cardWidth = (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLS - 1)) / COLS;

  return (
    <>
      <Stack.Screen options={{ title: genre || 'Browse' }} />
      <View style={styles.screen}>
        <Text style={styles.sub}>
          {genre} · across your enabled sources
        </Text>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <View style={styles.center}>
            <Text style={styles.errText}>Couldn’t load this genre.</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : !data || data.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.errText}>Nothing found for “{genre}”.</Text>
          </View>
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.key}
            numColumns={COLS}
            removeClippedSubviews
            initialNumToRender={9}
            maxToRenderPerBatch={9}
            windowSize={5}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: insets.bottom + spacing.xxl,
              gap: GAP,
            }}
            renderItem={({ item }) => {
              const multi = item.variants.length > 1;
              return (
                <MangaCard
                  width={cardWidth}
                  title={item.primary.title}
                  coverUrl={item.primary.coverUrl}
                  sourceLabel={
                    multi
                      ? `${item.variants.length} sources`
                      : sourceMeta(item.primary.sourceId).name
                  }
                  sourceColor={multi ? colors.accent : sourceMeta(item.primary.sourceId).color}
                  onPress={() =>
                    router.push({
                      pathname: '/manga/[id]',
                      params: { id: item.primary.externalId, sourceId: item.primary.sourceId },
                    })
                  }
                />
              );
            }}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing.sm },
  sub: {
    ...typography.caption,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
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
