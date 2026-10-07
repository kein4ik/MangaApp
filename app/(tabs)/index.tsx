import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { CoverArt } from '@/components/CoverArt';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { RailSkeleton } from '@/components/Skeleton';
import { SourceLangBar } from '@/components/SourceLangBar';
import { useContinueReading, useForYou, useTrending } from '@/data/queries';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import type { MangaSearchResult } from '@/data/sources/types';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const CARD_W = 124;

export default function HomeScreen() {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const { selectedSourceId, language, enabledLanguages, hiddenSources } = useSettings();

  const top = useTrending(selectedSourceId, language, 'popular');
  const latest = useTrending(selectedSourceId, language, 'latest');
  const continueReading = useContinueReading();

  // Home stays mounted under every pushed screen (manga page, reader), so all
  // of its background work is tied to it actually being on screen.
  const focused = useIsFocused();

  // "For you" is heavy (multi-source fetch + HTML parsing), so it only runs
  // while Home is on screen and has settled: never competing with first taps or
  // with the screen the user moved on to. Leaving Home stops a fetch still in
  // flight; library edits made elsewhere refresh it on the way back.
  // (Plain timer: InteractionManager is deprecated in this RN version.)
  const qc = useQueryClient();
  const [discoveryReady, setDiscoveryReady] = useState(false);
  useEffect(() => {
    if (!focused) {
      setDiscoveryReady(false);
      qc.cancelQueries({ queryKey: ['for-you'] });
      return;
    }
    const timer = setTimeout(() => setDiscoveryReady(true), 1500);
    return () => clearTimeout(timer);
  }, [focused, qc]);
  const forYou = useForYou(enabledLanguages, hiddenSources, discoveryReady);

  // Refresh "Continue reading" whenever Home regains focus (e.g. after reading
  // a chapter) so newly-read titles show up immediately, not after a refresh.
  const refetchContinue = continueReading.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchContinue();
    }, [refetchContinue]),
  );

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
    <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.wordmark}>Manga<Text style={{ color: colors.accent }}>App</Text></Text>
      <View style={styles.headerTools}><SourceLangBar />
        <Pressable style={styles.searchButton} onPress={() => router.push('/explore')} accessibilityLabel="Search manga"><Ionicons name="search-outline" size={24} color={colors.text} /></Pressable>
      </View>
    </View>
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: spacing.xxl }}
      refreshControl={
        <RefreshControl
          refreshing={top.isFetching}
          onRefresh={() => {
            top.refetch();
            latest.refetch();
            continueReading.refetch();
            forYou.refetch();
          }}
          tintColor={colors.accent}
        />
      }
    >
      {heroItems.length > 0 ? (
        <HeroCarousel
          items={heroItems}
          onOpen={openManga}
          paused={!focused}
        />
      ) : (
        <View style={styles.heroPlaceholder}>
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
                <Pressable style={styles.continueCard} onPress={() => router.push({ pathname: '/manga/[id]', params: { id: item.external_id, sourceId: item.source_id } })}>
                  <CoverArt uri={item.cover_url} title={item.title} style={styles.continueCover} />
                  <View style={styles.continueInfo}>
                    <Text style={styles.continueTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.continueMeta}>{item.chapter_number ? 'Ch. ' + item.chapter_number + ' · ' : ''}Page {item.page_index + 1}</Text>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: ((Math.max(0, Math.min(1, item.percent)) * 100) + '%') as `${number}%` }]} /></View>
                    <View style={styles.sourceLine}><View style={[styles.sourceDot, { backgroundColor: sourceMeta(item.source_id).color }]} /><Text style={styles.continueMeta}>{sourceMeta(item.source_id).name}</Text></View>
                  </View>
                </Pressable>
              )}
            />
          )}
        </View>
      )}

      {/* Personal genre rails — appear once the library knows some genres. */}
      {forYou.data?.map((rail) => (
        <View key={rail.genre} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Because you read <Text style={styles.genreAccent}>{rail.genre}</Text>
            </Text>
            <Pressable
              onPress={() => router.push({ pathname: '/browse', params: { genre: rail.genre } })}
              hitSlop={8}
            >
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          <FlatList
            horizontal
            data={rail.items}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            renderItem={({ item }) => (
              <MangaCard
                width={CARD_W}
                title={item.primary.title}
                sourceLabel={sourceMeta(item.primary.sourceId).name}
                sourceColor={sourceMeta(item.primary.sourceId).color}
                coverUrl={item.primary.coverUrl}
                onPress={() => openManga(item.primary)}
              />
            )}
          />
        </View>
      ))}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top mangas</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/top', params: { sort: 'popular' } })}
            hitSlop={8}
          >
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {top.isLoading ? (
          <RailSkeleton width={CARD_W} />
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
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {latest.isLoading ? (
          <RailSkeleton width={CARD_W} />
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
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: 16, gap: 10 },
  wordmark: { fontSize: 23, letterSpacing: -1, fontWeight: '800', color: colors.text },
  headerTools: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  searchButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  continueCard: { width: 310, padding: 12, borderRadius: 18, backgroundColor: colors.card, flexDirection: 'row', gap: 12 },
  continueCover: { width: 58, height: 84, borderRadius: 9 },
  continueInfo: { flex: 1, justifyContent: 'center', gap: 5 },
  continueTitle: { ...typography.bodyStrong, color: colors.text },
  continueMeta: { ...typography.caption, color: colors.textMuted },
  progressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', marginVertical: 2 },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  sourceLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  heroPlaceholder: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card, marginHorizontal: spacing.lg, borderRadius: 22,
  },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
    marginBottom: spacing.md,
  },
  seeAll: { ...typography.caption, color: colors.accent },
  genreAccent: { color: colors.accent },
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
