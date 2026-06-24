import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HealthBadge } from '@/components/HealthBadge';
import { SourceRegistry } from '@/data/sources/registry';
import { testSource, type SourceDiag } from '@/data/sources/diagnostics';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const SOURCES = SourceRegistry.all().map((p) => ({ id: p.id, name: p.name }));

export default function DiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const { hiddenSources, toggleHidden } = useSettings();
  const [results, setResults] = useState<Record<string, SourceDiag | 'loading'>>({});

  const runOne = useCallback(async (id: string) => {
    setResults((r) => ({ ...r, [id]: 'loading' }));
    const diag = await testSource(id);
    setResults((r) => ({ ...r, [id]: diag }));
  }, []);

  const runAll = useCallback(() => {
    SOURCES.forEach((s) => runOne(s.id));
  }, [runOne]);

  useEffect(() => {
    runAll();
  }, [runAll]);

  return (
    <>
      <Stack.Screen options={{ title: 'Source diagnostics' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingVertical: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
      >
        <View style={styles.headerRow}>
          <Text style={styles.subtitle}>Tap a source to re-test. Hide one to remove it everywhere.</Text>
          <Pressable style={styles.retryAll} onPress={runAll}>
            <Text style={styles.retryAllText}>↻ Test all</Text>
          </Pressable>
        </View>

        {SOURCES.map((s) => {
          const res = results[s.id];
          const hidden = hiddenSources.includes(s.id);
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.dot, { backgroundColor: sourceMeta(s.id).color }]} />
                <Text style={styles.name}>{s.name}</Text>
                <View style={{ flex: 1 }} />
                {res === 'loading' || res === undefined ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <HealthBadge status={res.status} />
                )}
              </View>

              {res && res !== 'loading' && (
                <View style={styles.steps}>
                  {res.steps.map((st) => (
                    <View key={st.name} style={styles.stepRow}>
                      <Text style={[styles.stepIcon, { color: st.ok ? colors.success : colors.danger }]}>
                        {st.ok ? '✓' : '✗'}
                      </Text>
                      <Text style={styles.stepName}>{st.name}</Text>
                      <Text style={styles.stepInfo} numberOfLines={1}>
                        {st.info} · {st.ms}ms
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.cardActions}>
                <Pressable style={styles.retryBtn} onPress={() => runOne(s.id)}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Text style={styles.hideLabel}>Hide</Text>
                <Switch
                  value={hidden}
                  onValueChange={() => toggleHidden(s.id)}
                  trackColor={{ true: colors.danger, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  subtitle: { ...typography.caption, color: colors.textMuted, flex: 1 },
  retryAll: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card },
  retryAllText: { ...typography.caption, color: colors.accent, fontWeight: '700' },

  card: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 9, height: 9, borderRadius: radius.pill },
  name: { ...typography.bodyStrong, color: colors.text },

  steps: { gap: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepIcon: { ...typography.bodyStrong, width: 16 },
  stepName: { ...typography.caption, color: colors.text, width: 70 },
  stepInfo: { ...typography.caption, color: colors.textFaint, flex: 1 },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.bgElevated },
  retryText: { ...typography.bodyStrong, color: colors.text },
  hideLabel: { ...typography.caption, color: colors.textMuted },
});
