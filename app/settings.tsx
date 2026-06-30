import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { languageLabel } from '@/components/languages';
import { clearLibrary, clearReadingProgress } from '@/data/local/db';
import { useSourcesQuery } from '@/data/queries';
import { sourceMeta } from '@/lib/sourceMeta';
import { contentLanguages, isSourceUsable } from '@/lib/sourceFilter';
import { useReaderSettings } from '@/store/reader.store';
import { useSearchHistory } from '@/store/search.store';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

export default function SettingsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reader = useReaderSettings();
  const { recent, clearRecent } = useSearchHistory();
  const sources = useSourcesQuery();
  const { enabledLanguages, hiddenSources, toggleLanguage, toggleHidden } = useSettings();
  const langs = contentLanguages(sources.data ?? []);
  // Sources whose language is enabled — these are the ones worth toggling on/off.
  const sourcesForLangs = (sources.data ?? []).filter((s) =>
    s.languages.some((l) => enabledLanguages.includes(l)),
  );
  const enabledCount = sourcesForLangs.filter(
    (s) => isSourceUsable(s, enabledLanguages, hiddenSources),
  ).length;

  const confirm = (title: string, message: string, onYes: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onYes },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
      >
        {/* ---------- Reading ---------- */}
        <Section title="Reading">
          <View style={styles.rowCol}>
            <Text style={styles.rowLabel}>Default reading mode</Text>
            <Segment
              options={[
                { value: 'vertical', label: '↕ Vertical' },
                { value: 'paged', label: '↔ Paged' },
              ]}
              value={reader.mode}
              onChange={(v) => reader.setMode(v as typeof reader.mode)}
            />
          </View>
          {reader.mode === 'paged' && (
            <View style={styles.rowCol}>
              <Text style={styles.rowLabel}>Page direction</Text>
              <Segment
                options={[
                  { value: 'ltr', label: 'L → R' },
                  { value: 'rtl', label: 'R → L' },
                ]}
                value={reader.direction}
                onChange={(v) => reader.setDirection(v as typeof reader.direction)}
              />
            </View>
          )}
          <ToggleRow
            label="Keep screen on while reading"
            value={reader.keepAwake}
            onChange={reader.setKeepAwake}
          />
        </Section>

        {/* ---------- Content languages ---------- */}
        <Section title="Content languages">
          {langs.map((code) => (
            <ToggleRow
              key={code}
              label={languageLabel(code)}
              value={enabledLanguages.includes(code)}
              onChange={() => toggleLanguage(code)}
            />
          ))}
        </Section>

        {/* ---------- Sources (only for enabled languages) ---------- */}
        <Section title="Sources">
          {sourcesForLangs.length === 0 ? (
            <Text style={styles.sourcesEmpty}>Enable a content language above to see sources.</Text>
          ) : (
            sourcesForLangs.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={styles.sourceRowLeft}>
                  <View style={[styles.dot, { backgroundColor: sourceMeta(s.id).color }]} />
                  <View>
                    <Text style={styles.rowLabelInline}>{s.name}</Text>
                    <Text style={styles.sourceLangs}>
                      {s.languages.slice(0, 4).map(languageLabel).join(', ')}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={!hiddenSources.includes(s.id)}
                  onValueChange={() => toggleHidden(s.id)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
            ))
          )}
          <ActionRow
            label="Source diagnostics"
            value={`${enabledCount} on`}
            onPress={() => router.push('/diagnostics')}
          />
        </Section>

        {/* ---------- Data ---------- */}
        <Section title="Data">
          <ActionRow
            label="Clear search history"
            value={recent.length ? `${recent.length}` : 'Empty'}
            onPress={() => recent.length && clearRecent()}
          />
          <ActionRow
            label="Clear image cache"
            onPress={() => {
              Image.clearMemoryCache();
              Image.clearDiskCache();
              Alert.alert('Done', 'Image cache cleared.');
            }}
          />
          <ActionRow
            label="Clear reading progress"
            danger
            onPress={() =>
              confirm('Clear reading progress?', 'Continue Reading and all positions will be removed.', async () => {
                await clearReadingProgress();
                qc.invalidateQueries({ queryKey: ['continue-reading'] });
                qc.invalidateQueries({ queryKey: ['library'] });
              })
            }
          />
          <ActionRow
            label="Clear library"
            danger
            onPress={() =>
              confirm('Clear library?', 'All saved titles and favourites will be removed.', async () => {
                await clearLibrary();
                qc.invalidateQueries({ queryKey: ['library'] });
              })
            }
          />
        </Section>

        {/* ---------- About ---------- */}
        <Section title="About">
          <View style={styles.aboutHead}>
            <Text style={styles.appName}>MangaApp</Text>
            <Text style={styles.version}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
          <Text style={styles.sourcesLabel}>Sources</Text>
          <View style={styles.sourceChips}>
            {sources.data?.map((s) => (
              <View key={s.id} style={styles.sourceChip}>
                <View style={[styles.dot, { backgroundColor: sourceMeta(s.id).color }]} />
                <Text style={styles.sourceChipText}>{s.name}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            A multi-source manga reader. Legal/official APIs only. Built as a portfolio project.
          </Text>
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabelInline}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

function ActionRow({
  label,
  value,
  danger,
  onPress,
}: {
  label: string;
  value?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
      <Text style={[styles.rowLabelInline, danger && { color: colors.danger }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[styles.segBtn, active && styles.segBtnActive]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.cardPressed },
  rowCol: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  sourceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sourceLangs: { ...typography.caption, color: colors.textFaint, marginTop: 1 },
  sourcesEmpty: { ...typography.caption, color: colors.textMuted, padding: spacing.lg },
  rowLabelInline: { ...typography.body, color: colors.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...typography.body, color: colors.textMuted },
  chevron: { color: colors.textFaint, fontSize: 20 },

  segment: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: radius.pill, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill, alignItems: 'center' },
  segBtnActive: { backgroundColor: colors.accent },
  segText: { ...typography.bodyStrong, color: colors.textMuted },
  segTextActive: { color: '#1A0E06' },

  aboutHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  appName: { ...typography.h3, color: colors.text },
  version: { ...typography.caption, color: colors.textFaint },
  sourcesLabel: {
    ...typography.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
  },
  sourceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, paddingTop: spacing.sm },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  sourceChipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  note: {
    ...typography.caption,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    lineHeight: 18,
  },
});
