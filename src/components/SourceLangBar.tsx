import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useSourcesQuery } from '@/data/queries';
import type { SourceInfo } from '@/data/sources/types';
import { isSourceUsable } from '@/lib/sourceFilter';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

import { BottomSheet } from './BottomSheet';
import { HealthBadge, HealthDot } from './HealthBadge';
import { languageLabel } from './languages';

/**
 * A compact source + language chip with a shared selection sheet. Switching a source resets the language if the new source doesn't
 * offer the current one — we never silently mix sources/languages.
 */
export function SourceLangBar() {
  const { selectedSourceId, language, enabledLanguages, hiddenSources, setSource, setLanguage } =
    useSettings();
  const sources = useSourcesQuery();
  const [sourceOpen, setSourceOpen] = useState(false);

  // Only offer sources for enabled content languages that aren't hidden.
  const visibleSources = sources.data?.filter((s) =>
    isSourceUsable(s, enabledLanguages, hiddenSources),
  );
  const current = sources.data?.find((s) => s.id === selectedSourceId);
  // Only offer the user's enabled content languages (we only use en/ru), not
  // every language a multi-language source like MangaDex technically supports.
  const enabledLangs = (current?.languages ?? []).filter((l) => enabledLanguages.includes(l));
  const langs = enabledLangs.length ? enabledLangs : [language];

  // Keep the selected source + language valid for the enabled content languages.
  // If the selected source's language gets disabled (e.g. you turn off English
  // while WEBTOON is selected), move to a usable source instead of leaving a
  // stale one selected. Then keep the language valid + enabled for that source.
  useEffect(() => {
    if (!sources.data) return;
    const usable = sources.data.filter((s) => isSourceUsable(s, enabledLanguages, hiddenSources));
    if (usable.length === 0) return;
    const pickLang = (s: SourceInfo) =>
      s.languages.find((l) => enabledLanguages.includes(l)) ?? s.languages[0] ?? 'en';

    const cur = usable.find((s) => s.id === selectedSourceId);
    if (!cur) {
      setSource(usable[0].id);
      setLanguage(pickLang(usable[0]));
    } else if (!cur.languages.includes(language) || !enabledLanguages.includes(language)) {
      setLanguage(pickLang(cur));
    }
  }, [sources.data, selectedSourceId, language, enabledLanguages, hiddenSources, setSource, setLanguage]);

  const onPickSource = (s: SourceInfo) => {
    setSource(s.id);
    if (!s.languages.includes(language)) setLanguage(s.languages[0] ?? 'en');
    setSourceOpen(false);
  };

  return (
    <View style={styles.bar}>
      <Pressable style={styles.chip} onPress={() => setSourceOpen(true)} accessibilityRole="button" accessibilityLabel="Choose source and language">
        {current && <HealthDot status={current.status} />}
        <Text style={styles.chipText} numberOfLines={1}>{current?.name ?? selectedSourceId} · {language.toUpperCase()}</Text>
        <Text style={styles.caret}>⌄</Text>
      </Pressable>
      {sources.isLoading && <ActivityIndicator size="small" color={colors.accent} />}

      {/* Source selector */}
      <BottomSheet visible={sourceOpen} title="Source & language" onClose={() => setSourceOpen(false)}>
        <ScrollView style={{ maxHeight: 360 }}>
          {langs.length > 1 && <View style={styles.languageRow}>{langs.map(code => <Pressable key={code} style={[styles.languageChip, code === language && styles.rowActive]} onPress={() => setLanguage(code)}><Text style={styles.rowTitle}>{languageLabel(code)}{code === language ? ' ✓' : ''}</Text></Pressable>)}</View>}
          {visibleSources?.map((s) => {
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
                    {s.languages
                      .filter((l) => enabledLanguages.includes(l))
                      .map((l) => l.toUpperCase())
                      .join(' · ') || '—'}
                  </Text>
                </View>
                <HealthBadge status={s.status} />
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
  languageRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  languageChip: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  bar: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 0,
  },
  chip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border, minHeight: 40, maxWidth: 220,
  },
  chipText: { ...typography.caption, fontWeight: '700', color: colors.text, flexShrink: 1 },
  caret: { color: colors.textFaint, fontSize: 11 },
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
