import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroCarousel } from '@/components/HeroCarousel';
import { FilterToggle, type HistoryFilter } from '@/components/FilterToggle';
import { MangaCard } from '@/components/MangaCard';
import { SourceLangBar } from '@/components/SourceLangBar';
import { useContinueReading, useTrending } from '@/data/queries';
import type { MangaSearchResult } from '@/data/sources/types';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const CARD_W = 124;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { selectedSourceId, language } = useSettings();

  const top = useTrending(selectedSourceId, language, 'popular');
  const latest = useTrending(selectedSourceId, language, 'latest');
  const continueReading = useContinueReading();

  const [filter, setFilter] = useState<HistoryFilter>('all');
  const history = useMemo(() => {
    const all = continueReading.data ?? [];
    return filter === 'source' ? all.filter((i) => i.source_id === selectedSourceId) : all;
  }, [continueReading.data, filter, selectedSourceId]);

  const heroItems = top.data?.slice(0, 5) ?? [];
  const topRest = top.data?.slice(5);

  const openManga = (m: { externalId: string; sourceId: string }) =>
    router.push({
      pathname: '/manga/[id]',
      params: { id: m.externalId, sourceId: m.sourceId },
    });

  const renderCard = ({ item }: { item: MangaSearchResult }) => (
    <MangaCard
      width={CARD_W}
      title={item.title}
      coverUrl={item.coverUrl}
      onPress={() => openManga(item)}
    />
  );

  return (
    <View style={styles.screen}>
    <Pressable
      style={[styles.gear, { top: insets.top + spacing.sm }]}
      onPress={() => router.push('/settings')}
      hitSlop={10}
    >
      <Text style={styles.gearIcon}>⚙</Text>
    </Pressable>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={top.isFetching}
          onRefresh={() => {
            top.refetch();
            latest.refetch();
            continueReading.refetch();
          }}
          tintColor={colors.accent}
        />
      }
    >
      {heroItems.length > 0 ? (
        <HeroCarousel items={heroItems} topInset={insets.top} onOpen={openManga} />
      ) : (
        <View style={[styles.heroPlaceholder, { paddingTop: insets.top }]}>
          {top.isError ? (
            <>
              <Text style={styles.errTitle}>{sourceMeta(selectedSourceId).name} is unavailable</Text>
              <Text style={styles.errHint}>
                The source may be down or slow. Pull to retry, or pick another in Sources.
              </Text>
              <Pressable style={styles.retryBtn} onPress={() => top.refetch()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      )}

      <SourceLangBar />

      {continueReading.data && continueReading.data.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Continue reading</Text>
            <FilterToggle
              value={filter}
              onChange={setFilter}
              currentLabel={sourceMeta(selectedSourceId).name}
            />
          </View>
          {history.length === 0 ? (
            <Text style={styles.emptyHistory}>
              Nothing from {sourceMeta(selectedSourceId).name} yet.
            </Text>
          ) : (
            <FlatList
              horizontal
              data={history}
              keyExtractor={(item) => `${item.source_id}:${item.external_id}`}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
              renderItem={({ item }) => (
                <MangaCard
                  width={CARD_W}
                  title={item.title}
                  coverUrl={item.cover_url}
                  subtitle={item.chapter_number ? `Ch. ${item.chapter_number}` : undefined}
                  progress={item.percent}
                  sourceLabel={sourceMeta(item.source_id).name}
                  sourceColor={sourceMeta(item.source_id).color}
                  onPress={() =>
                    router.push({
                      pathname: '/manga/[id]',
                      params: { id: item.external_id, sourceId: item.source_id },
                    })
                  }
                />
              )}
            />
          )}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top mangas</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/top', params: { sort: 'popular' } })}
            hitSlop={8}
          >
            <Text style={styles.seeAll}>see all</Text>
          </Pressable>
        </View>
        {top.isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.xl }} />
        ) : (
          <FlatList
            horizontal
            data={topRest}
            keyExtractor={(item) => item.externalId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            renderItem={renderCard}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Latest updates</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/top', params: { sort: 'latest' } })}
            hitSlop={8}
          >
            <Text style={styles.seeAll}>see all</Text>
          </Pressable>
        </View>
        {latest.isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.xl }} />
        ) : (
          <FlatList
            horizontal
            data={latest.data}
            keyExtractor={(item) => item.externalId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            renderItem={renderCard}
          />
        )}
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  gear: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIcon: { color: '#fff', fontSize: 18 },
  heroPlaceholder: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
    marginBottom: spacing.md,
  },
  seeAll: { ...typography.caption, color: colors.accent },
  emptyHistory: {
    ...typography.body,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rail: { paddingHorizontal: spacing.lg, gap: spacing.md },
  errTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  errHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  retryText: { ...typography.bodyStrong, color: '#1A0E06' },
});
