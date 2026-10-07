import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { CoverArt } from '@/components/CoverArt';
import { FeaturedManga } from '@/components/FeaturedManga';
import { BottomSheet } from '@/components/BottomSheet';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { useEffect, useMemo, useState } from 'react';
import {
  useWindowDimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MangaCard } from '@/components/MangaCard';
import { GridSkeleton } from '@/components/Skeleton';
import { SourceLangBar } from '@/components/SourceLangBar';
import { useDeadChapters, useSearch, useUnifiedSearch, useTrending, useSourcesQuery } from '@/data/queries';
import type { WorkCluster } from '@/data/sources/match';
import { isSourceUsable, isWorkDead } from '@/lib/sourceFilter';
import { sourceMeta } from '@/lib/sourceMeta';
import { GENRES, POPULAR_SEARCHES, useSearchHistory } from '@/store/search.store';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const COLS = 3;
const GAP = spacing.md;
type Status = 'all' | 'ongoing' | 'completed';
type Scope = 'all' | 'source';

export default function ExploreScreen() {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const { selectedSourceId, language, enabledLanguages, hiddenSources, setSource, setLanguage } = useSettings();
  const sources = useSourcesQuery();
  const available = (sources.data ?? []).filter(s => s.supportsSearch && isSourceUsable(s, enabledLanguages, hiddenSources));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const { recent, addRecent, removeRecent, clearRecent } = useSearchHistory();

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [scope, setScope] = useState<Scope>('all');

  // Debounce typing so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  // Only the active scope actually fires a request.
  const single = useSearch(selectedSourceId, scope === 'source' ? query : '', language);
  const unified = useUnifiedSearch(scope === 'all' ? query : '', enabledLanguages, hiddenSources);
  const active = scope === 'all' ? unified : single;
  const isLoading = active.isLoading;
  const isError = active.isError;

  // Tapping a recent / popular / genre chip runs that search immediately.
  const runSearch = (q: string) => {
    setInput(q);
    setQuery(q);
    addRecent(q);
  };

  const dead = useDeadChapters();

  // Normalize both modes to clusters so one list renders them. A single-source
  // result is just a cluster of one. Sources confirmed empty (no readable
  // chapters) are pruned; a work with no readable source left is dropped.
  const alive = useMemo<WorkCluster[] | undefined>(() => {
    let clusters: WorkCluster[] | undefined =
      scope === 'all'
        ? unified.data?.clusters
        : single.data?.map((m) => ({
            key: `${m.sourceId}:${m.externalId}`,
            primary: m,
            variants: [m],
          }));
    if (!clusters) return clusters;

    const deadKeys = new Set(dead.data ?? []);
    clusters = clusters
      .map((c) => {
        const alive = c.variants.filter(
          (v) =>
            !isWorkDead(
              deadKeys,
              v.sourceId,
              v.externalId,
              v.languages.filter((l) => enabledLanguages.includes(l)),
            ),
        );
        if (alive.length === 0) return null;
        return { ...c, primary: alive.includes(c.primary) ? c.primary : alive[0], variants: alive };
      })
      .filter((c): c is WorkCluster => c !== null);
    return clusters;
  }, [scope, unified.data, single.data, dead.data, enabledLanguages]);

  const results = useMemo(
    () => (!alive || status === 'all' ? alive : alive.filter((c) => c.primary.status === status)),
    [alive, status],
  );
  // Sources that errored during an all-sources search — named, not hidden.
  const failedSources = scope === 'all' ? unified.data?.failedSources ?? [] : [];

  const statusChips = (
    <View style={styles.resultFilters}>
      {(['all', 'ongoing', 'completed'] as Status[]).map((s) => (
        <Pressable
          key={s}
          style={[styles.statusChip, status === s && styles.statusChipActive]}
          onPress={() => setStatus(s)}
        >
          <Text style={[styles.statusText, status === s && styles.statusTextActive]}>
            {s === 'all' ? 'All' : s === 'ongoing' ? 'Ongoing' : 'Completed'}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const cardWidth =
    (width - spacing.lg * 2 - GAP * (COLS - 1)) / COLS;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.pageHeading}><Text style={styles.pageTitle}>Explore</Text><Text style={styles.pageSubtitle}>One search across {available.length || 'your'} sources</Text></View>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={21} color={colors.textMuted} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => input.trim() && addRecent(input.trim())}
          placeholder={scope === 'all' ? 'Search all sources…' : `Search ${selectedSourceId}…`}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
        />
        <Pressable onPress={() => setFiltersOpen(true)} style={styles.filterButton} accessibilityLabel="Search filters"><Ionicons name="options-outline" size={23} color={status !== 'all' ? colors.accent : colors.textMuted} /></Pressable>
        {input.length > 0 && (
          <Pressable onPress={() => { setInput(''); setQuery(''); }} hitSlop={10}>
            <Text style={styles.clearX}>✕</Text>
          </Pressable>
        )}
      </View>

      <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeRow}>
        <Pressable style={[styles.scopeChip, scope === 'all' && styles.scopeChipActive]} onPress={() => setScope('all')}><Text style={[styles.scopeText, scope === 'all' && styles.scopeTextActive]}>All sources</Text></Pressable>
        {available.map(source => { const chosen = scope === 'source' && source.id === selectedSourceId; return <Pressable key={source.id} style={[styles.scopeChip, chosen && styles.scopeChipActive]} onPress={() => { setScope('source'); setSource(source.id); if (!source.languages.includes(language)) setLanguage(source.languages.find(l => enabledLanguages.includes(l)) ?? source.languages[0] ?? 'en'); }}><View style={[styles.dot, { backgroundColor: sourceMeta(source.id).color }]} /><Text style={[styles.scopeText, chosen && styles.scopeTextActive]}>{source.name}</Text></Pressable>; })}
      </ScrollView></View>

      {query.length === 0 ? (
        // ---------- Discovery (no query) ----------
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {focused && <ExploreDiscovery sourceId={selectedSourceId} language={language} />}
          {recent.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Last search</Text>
                <Pressable onPress={clearRecent} hitSlop={8}>
                  <Text style={styles.clearAll}>clear all</Text>
                </Pressable>
              </View>
              {recent.map((q) => (
                <Pressable key={q} style={styles.recentRow} onPress={() => runSearch(q)}>
                  <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.recentText} numberOfLines={1}>{q}</Text>
                  <Pressable onPress={() => removeRecent(q)} hitSlop={10}>
                    <Text style={styles.recentRemove}>✕</Text>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Popular search</Text>
            <View style={styles.chipWrap}>
              {POPULAR_SEARCHES.map((q) => (
                <Pressable key={q} style={styles.chip} onPress={() => runSearch(q)}>
                  <Text style={styles.chipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>More genres</Text>
            <Text style={styles.subLabel}>Status</Text>
            <View style={styles.chipWrap}>
              {(['all', 'ongoing', 'completed'] as Status[]).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.statusChip, status === s && styles.statusChipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.statusText, status === s && styles.statusTextActive]}>
                    {s === 'all' ? 'All' : s === 'ongoing' ? 'Ongoing' : 'Completed'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.subLabel}>Genres</Text>
            <View style={styles.chipWrap}>
              {GENRES.map((g) => (
                <Pressable
                  key={g}
                  style={styles.genreChip}
                  onPress={() => router.push({ pathname: '/browse', params: { genre: g } })}
                >
                  <Text style={styles.genreText}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : isLoading ? (
        <GridSkeleton width={cardWidth} columns={COLS} />
      ) : isError ? (
        <View style={styles.messageBox}>
          <Text style={styles.hint}>Search failed — no source answered.</Text>
          <Pressable style={styles.inlineBtn} onPress={() => active.refetch()}>
            <Text style={styles.inlineBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Outside the list, so the filter stays reachable when it empties it. */}
          {statusChips}
          {failedSources.length > 0 && (
            <Text style={styles.failedNote}>
              Didn’t answer: {failedSources.map((s) => sourceMeta(s).name).join(', ')}
            </Text>
          )}
          {results && results.length === 0 ? (
            alive && alive.length > 0 ? (
              <View style={styles.messageBox}>
                <Text style={styles.hint}>
                  None of the {alive.length} results for “{query}” is {status}.
                </Text>
                <Pressable style={styles.inlineBtn} onPress={() => setStatus('all')}>
                  <Text style={styles.inlineBtnText}>Show all</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.hint}>No results for “{query}”.</Text>
            )
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.key}
              numColumns={COLS}
              removeClippedSubviews
              initialNumToRender={9}
              maxToRenderPerBatch={9}
              windowSize={5}
              columnWrapperStyle={{ gap: GAP }}
              contentContainerStyle={{
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.xxl,
                gap: GAP,
              }}
              keyboardShouldPersistTaps="handled"
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
                    onPress={() => {
                      addRecent(query);
                      router.push({
                        pathname: '/manga/[id]',
                        params: { id: item.primary.externalId, sourceId: item.primary.sourceId },
                      });
                    }}
                  />
                );
              }}
            />
          )}
        </>
      )}
      <BottomSheet visible={filtersOpen} title="Search filters" onClose={() => setFiltersOpen(false)}><Text style={styles.subLabel}>Status</Text>{statusChips}<Text style={styles.subLabel}>Source & language</Text><SourceLangBar /></BottomSheet>
    </View>
  );
}

function ExploreDiscovery({ sourceId, language }: { sourceId: string; language: string }) {
  const router = useGuardedRouter();
  // Same query key as Home: navigating here reuses the existing catalog.
  const popular = useTrending(sourceId, language, 'popular');
  const books = popular.data ?? [];
  return <>
    {books[0] && <View style={styles.discoveryHero}><FeaturedManga manga={books[0]} compact onPress={() => router.push({ pathname: '/manga/[id]', params: { id: books[0].externalId, sourceId } })} /></View>}
    <View style={styles.section}><Text style={styles.sectionTitle}>Browse genres</Text><View style={styles.genreGrid}>
      {['Action', 'Fantasy', 'Romance', 'Mystery'].map((genre, i) => <Pressable key={genre} style={styles.genreTile} onPress={() => router.push({ pathname: '/browse', params: { genre } })}>
        <View pointerEvents="none" style={styles.genreArtwork}>{books.slice(i, i + 3).map((book, n) => <CoverArt key={book.externalId} uri={book.coverUrl} title={book.title} style={[styles.genreCover, { right: n * 16, transform: [{ rotate: (n * 9 - 12) + 'deg' }] }]} />)}</View><Text style={styles.genreTitle}>{genre}</Text>
      </Pressable>)}
    </View></View>
    {books.length > 0 && <View style={styles.section}><View style={styles.sectionHead}><Text style={styles.sectionTitle}>Popular on {sourceMeta(sourceId).name}</Text><Pressable onPress={() => router.push({ pathname: '/top', params: { sort: 'popular' } })}><Text style={styles.clearAll}>See all</Text></Pressable></View><FlatList horizontal data={books.slice(0, 12)} showsHorizontalScrollIndicator={false} keyExtractor={m => m.externalId} contentContainerStyle={{ gap: 12 }} renderItem={({ item }) => <MangaCard width={112} title={item.title} coverUrl={item.coverUrl} onPress={() => router.push({ pathname: '/manga/[id]', params: { id: item.externalId, sourceId: item.sourceId } })} />} /></View>}
    {popular.isError && <Pressable style={styles.catalogError} onPress={() => popular.refetch()}><Text style={styles.catalogErrorText}>Couldn’t load the catalog. Tap to retry, or search another source.</Text></Pressable>}
  </>;
}

const styles = StyleSheet.create({
  pageHeading: { paddingHorizontal: 16, marginBottom: 18 },
  pageTitle: { fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  pageSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 5 },
  filterButton: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  discoveryHero: { paddingHorizontal: 16, marginTop: 4 },
  genreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  genreTile: { width: '48%', flexGrow: 1, height: 90, backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', padding: 14, justifyContent: 'flex-end' },
  genreArtwork: { position: 'absolute', right: 4, top: 8, width: 84, height: 82, opacity: 0.5 },
  genreCover: { position: 'absolute', top: 5, width: 46, height: 68, borderRadius: 6 },
  genreTitle: { ...typography.bodyStrong, color: colors.text },
  catalogError: { margin: 16, padding: 16, borderRadius: 14, backgroundColor: colors.card },
  catalogErrorText: { ...typography.caption, color: colors.textMuted },
  screen: { flex: 1, backgroundColor: colors.bg },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
  },
  input: { flex: 1, color: colors.text, ...typography.body },
  clearX: { color: colors.textFaint, fontSize: 15 },
  hint: { ...typography.body, color: colors.textMuted, padding: spacing.lg },

  section: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  clearAll: { ...typography.caption, color: colors.accent },
  subLabel: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  recentText: { ...typography.body, color: colors.textMuted, flex: 1 },
  recentRemove: { color: colors.textFaint, fontSize: 13 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  chipText: { ...typography.caption, color: colors.text },
  genreChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  genreText: { ...typography.caption, color: colors.purple },
  statusChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  statusChipActive: { backgroundColor: colors.accentMuted },
  statusText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  statusTextActive: { color: colors.accent },

  resultFilters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  failedNote: {
    ...typography.caption,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  messageBox: { alignItems: 'flex-start', gap: spacing.sm },
  inlineBtn: {
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentMuted,
  },
  inlineBtnText: { ...typography.caption, color: colors.accent, fontWeight: '700' },

  scopeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  scopeChip: {
    flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scopeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  scopeText: { ...typography.caption, color: colors.textMuted, fontWeight: '600', textTransform: 'capitalize' },
  scopeTextActive: { color: '#1A0E06' },
});
