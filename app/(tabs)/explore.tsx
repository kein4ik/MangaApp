import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
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
import { SourceLangBar } from '@/components/SourceLangBar';
import { useSearch } from '@/data/queries';
import { GENRES, POPULAR_SEARCHES, useSearchHistory } from '@/store/search.store';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const COLS = 3;
const GAP = spacing.md;
type Status = 'all' | 'ongoing' | 'completed';

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { selectedSourceId, language } = useSettings();
  const { recent, addRecent, removeRecent, clearRecent } = useSearchHistory();

  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');

  // Debounce typing so we don't fire a request on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 400);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isError } = useSearch(selectedSourceId, query, language);

  // Tapping a recent / popular / genre chip runs that search immediately.
  const runSearch = (q: string) => {
    setInput(q);
    setQuery(q);
    addRecent(q);
  };

  const results = useMemo(() => {
    if (!data) return data;
    return status === 'all' ? data : data.filter((m) => m.status === status);
  }, [data, status]);

  const cardWidth =
    (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLS - 1)) / COLS;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <SourceLangBar />
      <View style={styles.searchBox}>
        <Text style={{ color: colors.textFaint }}>🔍</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => input.trim() && addRecent(input.trim())}
          placeholder={`Search ${selectedSourceId}…`}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
        />
        {input.length > 0 && (
          <Pressable onPress={() => { setInput(''); setQuery(''); }} hitSlop={10}>
            <Text style={styles.clearX}>✕</Text>
          </Pressable>
        )}
      </View>

      {query.length === 0 ? (
        // ---------- Discovery (no query) ----------
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
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
                  <Text style={styles.recentIcon}>🕘</Text>
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
            <Text style={styles.sectionTitle}>Quick filters</Text>
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
                <Pressable key={g} style={styles.genreChip} onPress={() => runSearch(g)}>
                  <Text style={styles.genreText}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
      ) : isError ? (
        <Text style={styles.hint}>Search failed. Try again.</Text>
      ) : results && results.length === 0 ? (
        <Text style={styles.hint}>No results for “{query}”.</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.externalId}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
            gap: GAP,
          }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
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
          }
          renderItem={({ item }) => (
            <MangaCard
              width={cardWidth}
              title={item.title}
              coverUrl={item.coverUrl}
              onPress={() => {
                addRecent(query);
                router.push({
                  pathname: '/manga/[id]',
                  params: { id: item.externalId, sourceId: item.sourceId },
                });
              }}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.card,
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
  recentIcon: { fontSize: 14 },
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

  resultFilters: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.md },
});
