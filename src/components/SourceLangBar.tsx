import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSourcesQuery } from '@/data/queries';
import type { SourceInfo } from '@/data/sources/types';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

import { BottomSheet } from './BottomSheet';
import { HealthBadge, HealthDot } from './HealthBadge';
import { languageLabel } from './languages';

/**
 * The source + language switcher (Phase 3). Two chips that open selection
 * sheets. Switching a source resets the language if the new source doesn't
 * offer the current one — we never silently mix sources/languages.
 */
export function SourceLangBar() {
  const { selectedSourceId, language, setSource, setLanguage } = useSettings();
  const sources = useSourcesQuery();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const current = sources.data?.find((s) => s.id === selectedSourceId);
  const langs = current?.languages ?? ['en'];

  // Keep the language valid for the selected source. A RU-only source (MangaLib,
  // Remanga) can never be "English" — correct any stale combo automatically.
  useEffect(() => {
    if (current && !current.languages.includes(language)) {
      setLanguage(current.languages[0] ?? 'en');
    }
  }, [current, language, setLanguage]);

  const onPickSource = (s: SourceInfo) => {
    setSource(s.id);
    if (!s.languages.includes(language)) setLanguage(s.languages[0] ?? 'en');
    setSourceOpen(false);
  };

  return (
    <View style={styles.bar}>
      <Pressable style={styles.chip} onPress={() => setSourceOpen(true)}>
        {current && <HealthDot status={current.status} />}
        <Text style={styles.chipText}>{current?.name ?? selectedSourceId}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      {/* Only offer a language switch when the source actually has options. */}
      {langs.length > 1 ? (
        <Pressable style={styles.chip} onPress={() => setLangOpen(true)}>
          <Text style={styles.chipText}>{languageLabel(language)}</Text>
          <Text style={styles.caret}>▾</Text>
        </Pressable>
      ) : (
        <View style={[styles.chip, styles.chipStatic]}>
          <Text style={styles.chipText}>{languageLabel(langs[0])}</Text>
        </View>
      )}

      {sources.isLoading && <ActivityIndicator size="small" color={colors.accent} />}

      {/* Source selector */}
      <BottomSheet visible={sourceOpen} title="Source" onClose={() => setSourceOpen(false)}>
        {sources.isError && <Text style={styles.error}>Backend unreachable. Is it running?</Text>}
        <ScrollView style={{ maxHeight: 360 }}>
          {sources.data?.map((s) => {
            const active = s.id === selectedSourceId;
            return (
              <Pressable
                key={s.id}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => onPickSource(s)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{s.name}</Text>
                  <Text style={styles.rowMeta}>
                    {s.supportsReading ? 'Reading + info' : 'Info only'} ·{' '}
                    {s.languages.length} langs
                  </Text>
                </View>
                <HealthBadge status={s.status} />
                {active && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>

      {/* Language selector */}
      <BottomSheet visible={langOpen} title="Language" onClose={() => setLangOpen(false)}>
        <ScrollView style={{ maxHeight: 360 }}>
          {langs.map((code) => {
            const active = code === language;
            return (
              <Pressable
                key={code}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => {
                  setLanguage(code);
                  setLangOpen(false);
                }}
              >
                <Text style={styles.rowTitle}>{languageLabel(code)}</Text>
                {active && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  chipStatic: { backgroundColor: colors.bgElevated },
  chipText: { ...typography.bodyStrong, color: colors.text },
  caret: { color: colors.textFaint, fontSize: 11 },
  error: { ...typography.body, color: colors.danger, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: colors.card },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  check: { ...typography.bodyStrong, color: colors.accent },
});
