import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { languageLabel } from '@/components/languages';
import { SourceCard } from '@/components/SourceCard';
import { useSourcesQuery } from '@/data/queries';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

// Preferred display order for language chips; the rest follow alphabetically.
const LANG_ORDER = ['en', 'ru', 'es', 'fr', 'pt-br', 'de', 'it', 'ja', 'ko'];

export default function SourcesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sourcesQ = useSourcesQuery();
  const { selectedSourceId, language, hiddenSources, setSource, setLanguage } = useSettings();

  const [viewLang, setViewLang] = useState(language);

  const allLanguages = useMemo(() => {
    const set = new Set<string>();
    sourcesQ.data?.forEach((s) => s.languages.forEach((l) => set.add(l)));
    return [...set].sort((a, b) => {
      const ia = LANG_ORDER.indexOf(a);
      const ib = LANG_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  }, [sourcesQ.data]);

  const sourcesForLang = useMemo(
    () =>
      sourcesQ.data?.filter(
        (s) => s.languages.includes(viewLang) && !hiddenSources.includes(s.id),
      ) ?? [],
    [sourcesQ.data, viewLang, hiddenSources],
  );

  const pickSource = (id: string) => {
    setSource(id);
    setLanguage(viewLang);
    // Drop the reader straight into browsing with the new source.
    router.push('/explore');
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + spacing.md,
        paddingBottom: spacing.xxl,
      }}
    >
      <Text style={styles.title}>Sources</Text>
      <Text style={styles.subtitle}>Pick a language, then choose a source to read from.</Text>

      {/* Active selection banner */}
      <View style={styles.activeBanner}>
        <Text style={styles.activeBannerLabel}>Currently reading from</Text>
        <Text style={styles.activeBannerValue}>
          {sourcesQ.data?.find((s) => s.id === selectedSourceId)?.name ?? selectedSourceId}
          {'  ·  '}
          {languageLabel(language)}
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Language</Text>
      <View style={styles.langRow}>
        {sourcesQ.isLoading && <ActivityIndicator color={colors.accent} />}
        {allLanguages.map((code) => {
          const active = code === viewLang;
          return (
            <Pressable
              key={code}
              onPress={() => setViewLang(code)}
              style={[styles.langChip, active && styles.langChipActive]}
            >
              <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                {languageLabel(code)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>
        Sources in {languageLabel(viewLang)}
        {sourcesForLang.length > 0 ? ` (${sourcesForLang.length})` : ''}
      </Text>

      {sourcesQ.isError ? (
        <Text style={styles.error}>Can’t reach the backend. Is it running?</Text>
      ) : sourcesForLang.length === 0 && !sourcesQ.isLoading ? (
        <Text style={styles.empty}>No sources offer this language yet.</Text>
      ) : (
        <View style={styles.grid}>
          {sourcesForLang.map((s, i) => (
            <View key={s.id} style={styles.gridItem}>
              <SourceCard
                source={s}
                accent={sourceMeta(s.id, i).color}
                active={s.id === selectedSourceId && viewLang === language}
                onPress={() => pickSource(s.id)}
              />
            </View>
          ))}
        </View>
      )}

      <Text style={styles.hint}>
        More languages and sources are coming. Each source can be turned off
        instantly if it goes down.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { ...typography.h1, color: colors.text, paddingHorizontal: spacing.lg },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    marginTop: 2,
  },

  activeBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  activeBannerLabel: { ...typography.tiny, color: colors.textFaint, textTransform: 'uppercase' },
  activeBannerValue: { ...typography.bodyStrong, color: colors.text, marginTop: 3 },

  sectionLabel: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  langChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  langChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  langChipText: { ...typography.bodyStrong, color: colors.textMuted },
  langChipTextActive: { color: colors.accent },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  gridItem: { width: '47.5%', flexGrow: 1 },

  error: { ...typography.body, color: colors.danger, paddingHorizontal: spacing.lg },
  empty: { ...typography.body, color: colors.textMuted, paddingHorizontal: spacing.lg },
  hint: {
    ...typography.caption,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    lineHeight: 18,
  },
});
