import { Ionicons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { BottomSheet } from '@/components/BottomSheet';
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { languageLabel } from '@/components/languages';
import { fmtBytes } from '@/lib/format';
import {
  useClearLibrary,
  useClearReadingProgress,
  useDeleteDownload,
  useDownloadsSize,
  useDownloadedManga,
  useSourcesQuery,
} from '@/data/queries';
import { registerChapterCheck, unregisterChapterCheck } from '@/lib/backgroundUpdates';
import { checkForNewChapters } from '@/lib/chapterCheck';
import { ensureNotificationPermission, setupAndroidChannel } from '@/lib/notifications';
import { getLastBackgroundRun, setNotifyEnabledFlag } from '@/lib/notifyPrefs';
import { isExpoGo } from '@/lib/runtime';
import { timeAgo } from '@/lib/time';
import { sourceMeta } from '@/lib/sourceMeta';
import { contentLanguages, isSourceUsable } from '@/lib/sourceFilter';
import { useReaderSettings } from '@/store/reader.store';
import { useSearchHistory } from '@/store/search.store';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

export default function SettingsScreen() { return <SettingsContent />; }

export function SettingsContent({ tab = false }: { tab?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reader = useReaderSettings();
  const { recent, clearRecent } = useSearchHistory();
  const sources = useSourcesQuery();
  const downloadsSize = useDownloadsSize();
  const deleteDownload = useDeleteDownload();
  const savedTitles = useDownloadedManga();
  const [sheet, selectSheet] = useState<'mode' | 'direction' | 'gap' | 'languages' | 'sources' | 'data' | 'about' | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const setSheet = (next: typeof sheet) => {
    // Keep content in place while the sheet animates closed.
    if (next !== null) selectSheet(next);
    setSheetVisible(next !== null);
  };
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    try {
      const bytes = Paths.availableDiskSpace;
      if (typeof bytes === 'number' && Number.isFinite(bytes)) setFreeSpace(bytes);
    } catch { /* Storage details are optional on unsupported platforms. */ }
  }, [downloadsSize.data]);
  const modeLabel = reader.mode === 'vertical' ? 'Vertical' : 'Paged';
  const directionLabel = reader.direction === 'ltr' ? 'Left to right' : 'Right to left';
  const gapLabel = reader.pageGap === 0 ? 'None' : reader.pageGap <= 8 ? 'Small' : 'Large';
  const clearProgress = useClearReadingProgress();
  const clearLib = useClearLibrary();
  // When the OS last actually ran the background chapter check.
  const [lastRun, setLastRun] = useState<number | null>(null);
  useEffect(() => {
    getLastBackgroundRun().then(setLastRun);
  }, []);
  const {
    enabledLanguages,
    hiddenSources,
    toggleLanguage,
    toggleHidden,
    notifyChapters,
    setNotifyChapters,
  } = useSettings();
  const langs = contentLanguages(sources.data ?? []);
  // Sources whose language is enabled — these are the ones worth toggling on/off.
  const sourcesForLangs = (sources.data ?? []).filter((s) =>
    s.languages.some((l) => enabledLanguages.includes(l)),
  );
  const enabledCount = sourcesForLangs.filter(
    (s) => isSourceUsable(s, enabledLanguages, hiddenSources),
  ).length;

  // Turning off the last language / last source would leave Home, search and
  // the source picker with nothing valid — and the old selection kept loading.
  const onToggleLanguage = (code: string) => {
    if (enabledLanguages.length === 1 && enabledLanguages.includes(code)) {
      Alert.alert('Keep one language', 'At least one content language has to stay on.');
      return;
    }
    const nextLangs = enabledLanguages.includes(code)
      ? enabledLanguages.filter((l) => l !== code)
      : [...enabledLanguages, code];
    const stillUsable = (sources.data ?? []).some((s) => isSourceUsable(s, nextLangs, hiddenSources));
    if (!stillUsable) {
      Alert.alert('No source left', 'Every source for the remaining languages is turned off below.');
      return;
    }
    toggleLanguage(code);
  };

  const onToggleSource = (id: string) => {
    if (!hiddenSources.includes(id)) {
      const others = (sources.data ?? []).filter(
        (s) => s.id !== id && isSourceUsable(s, enabledLanguages, hiddenSources),
      );
      if (others.length === 0) {
        Alert.alert('Keep one source', 'At least one source has to stay on.');
        return;
      }
    }
    toggleHidden(id);
  };

  const confirm = (title: string, message: string, onYes: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onYes },
    ]);

  const onToggleNotify = async (on: boolean) => {
    if (on && isExpoGo) {
      Alert.alert(
        'Needs a real build',
        'Notifications don’t work in Expo Go. Install a dev/EAS build of the app to use chapter notifications.',
      );
      return;
    }
    if (!on) {
      setNotifyChapters(false);
      await setNotifyEnabledFlag(false);
      await unregisterChapterCheck();
      return;
    }
    const granted = await ensureNotificationPermission();
    if (!granted) {
      Alert.alert(
        'Notifications are off',
        'Allow notifications for MangaApp in your system settings, then try again.',
      );
      return;
    }
    await setupAndroidChannel();
    setNotifyChapters(true);
    await setNotifyEnabledFlag(true);
    await registerChapterCheck();
    // Record a silent baseline (fire-and-forget: walking the whole library can
    // take a while, and the toggle shouldn't hang on it).
    checkForNewChapters(false).catch(() => {});
    Alert.alert(
      'Notifications on',
      "We'll let you know when titles in your library get new chapters. New chapters are checked about once an hour.",
    );
  };

  const onCheckNow = async () => {
    if (isExpoGo) {
      Alert.alert(
        'Needs a real build',
        'Chapter checking uses notifications, which don’t run in Expo Go. Try it on a dev/EAS build.',
      );
      return;
    }
    const granted = await ensureNotificationPermission();
    if (!granted) {
      Alert.alert('Notifications are off', 'Turn on notifications first.');
      return;
    }
    await setupAndroidChannel();
    const hits = await checkForNewChapters(true);
    Alert.alert(
      'Checked for updates',
      hits.length
        ? `${hits.length} title${hits.length > 1 ? 's have' : ' has'} a new chapter.`
        : 'No new chapters right now.',
    );
  };

  return <>
    {!tab && <Stack.Screen options={{ headerShown: false }} />}
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
      <View style={styles.heading}>{!tab && <Pressable accessibilityLabel="Go back" onPress={() => router.back()} style={styles.backButton}><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable>}<Text style={styles.headingText}>Settings</Text></View>
      <Pressable style={styles.preview} onPress={() => setSheet('mode')}>
        <View style={styles.previewBook}><View style={styles.previewPage} /><View style={[styles.previewPage, { backgroundColor: '#542A32' }]} /></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={styles.previewTitle}>Your reading setup</Text><Text style={styles.previewCaption}>{modeLabel}{reader.mode === 'paged' ? ' · ' + directionLabel : ''} · {gapLabel.toLowerCase()} gap</Text></View><Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
      </Pressable>
      <Section title="Reading">
        <ActionRow icon="book-outline" label="Reading mode" value={modeLabel} onPress={() => setSheet('mode')} />
        <ActionRow icon="arrow-forward-outline" label="Page direction" value={directionLabel} disabled={reader.mode === 'vertical'} onPress={() => setSheet('direction')} />
        <ActionRow icon="resize-outline" label="Page gap" value={gapLabel} onPress={() => setSheet('gap')} />
        <ToggleRow icon="eye-outline" label="Keep screen awake" value={reader.keepAwake} onChange={reader.setKeepAwake} />
      </Section>
      <Section title="Content">
        <ActionRow icon="globe-outline" label="Languages" value={enabledLanguages.map(languageLabel).join(', ')} onPress={() => setSheet('languages')} />
        <ActionRow icon="layers-outline" label="Sources" value={enabledCount + ' enabled · ' + hiddenSources.length + ' hidden'} onPress={() => setSheet('sources')} />
        <ToggleRow icon="notifications-outline" label="New chapter alerts" value={notifyChapters} onChange={onToggleNotify} />
        <Text style={styles.note}>Library titles · checked in the background{lastRun ? ' · last ran ' + timeAgo(lastRun) : ''}</Text>
        <ActionRow icon="refresh-outline" label="Check for updates now" onPress={onCheckNow} />
      </Section>
      <Section title="Storage">
        <View style={styles.storageHeader}><Ionicons name="download-outline" size={22} color={colors.textMuted} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowLabelInline}>Downloads</Text><Text style={styles.sourceLangs}>{(savedTitles.data ?? []).reduce((n, m) => n + m.chapters, 0)} chapters · {savedTitles.data?.length ?? 0} titles</Text></View><Text style={styles.storageSize}>{fmtBytes(downloadsSize.data ?? 0)}</Text></View>
        {freeSpace !== null && <View style={styles.storageTrack}><View style={[styles.storageFill, { width: (((downloadsSize.data ?? 0) / Math.max(1, freeSpace + (downloadsSize.data ?? 0)) * 100) + '%') as `${number}%` }]} /></View>}
        <View style={styles.storageFooter}><Text style={styles.sourceLangs}>{freeSpace !== null ? fmtBytes(freeSpace) + ' free on this phone' : 'Saved on this device'}</Text><Pressable style={styles.manageButton} onPress={() => router.push({ pathname: '/library', params: { category: 'downloads' } })}><Text style={styles.manageText}>Manage</Text><Ionicons name="chevron-forward" size={16} color={colors.accent} /></Pressable></View>
      </Section>
      <Section title="More"><ActionRow icon="server-outline" label="Data & storage tools" onPress={() => setSheet('data')} /><ActionRow icon="information-circle-outline" label="About MangaApp" value={'v' + (Constants.expoConfig?.version ?? '1.0.0')} onPress={() => setSheet('about')} /></Section>
    </ScrollView>
    <BottomSheet visible={sheetVisible} title={sheet === 'mode' ? 'Reading mode' : sheet === 'direction' ? 'Page direction' : sheet === 'gap' ? 'Page gap' : sheet === 'languages' ? 'Content languages' : sheet === 'sources' ? 'Sources' : sheet === 'data' ? 'Data & storage' : 'About MangaApp'} onClose={() => setSheet(null)}>
      <ScrollView style={{ maxHeight: 460 }}>
        {sheet === 'mode' && <Segment options={[{ value: 'vertical', label: 'Vertical' }, { value: 'paged', label: 'Paged' }]} value={reader.mode} onChange={v => { reader.setMode(v); setSheet(null); }} />}
        {sheet === 'direction' && <Segment options={[{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }]} value={reader.direction} onChange={v => { reader.setDirection(v); setSheet(null); }} />}
        {sheet === 'gap' && <Segment options={[{ value: '0', label: 'None' }, { value: '8', label: 'Small' }, { value: '16', label: 'Large' }]} value={String(reader.pageGap)} onChange={v => { reader.setPageGap(Number(v)); setSheet(null); }} />}
        {sheet === 'languages' && langs.map(code => <ToggleRow key={code} label={languageLabel(code)} value={enabledLanguages.includes(code)} onChange={() => onToggleLanguage(code)} />)}
        {sheet === 'sources' && <>{sourcesForLangs.map(source => <View key={source.id} style={styles.row}><View style={styles.sourceRowLeft}><View style={[styles.dot, { backgroundColor: sourceMeta(source.id).color }]} /><View><Text style={styles.rowLabelInline}>{source.name}</Text><Text style={styles.sourceLangs}>{source.languages.filter(l => enabledLanguages.includes(l)).map(languageLabel).join(', ')}</Text></View></View><Switch accessibilityLabel={source.name} value={!hiddenSources.includes(source.id)} onValueChange={() => onToggleSource(source.id)} trackColor={{ true: colors.accent, false: colors.border }} thumbColor={hiddenSources.includes(source.id) ? colors.textMuted : '#241006'} /></View>)}<ActionRow label="Browse sources" onPress={() => { setSheet(null); router.push('/sources'); }} /><ActionRow label="Source diagnostics" onPress={() => { setSheet(null); router.push('/diagnostics'); }} /></>}
        {sheet === 'data' && <>        {/* ---------- Data ---------- */}
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
            label="Clear downloads"
            value={fmtBytes(downloadsSize.data ?? 0)}
            danger
            onPress={() =>
              confirm('Clear downloads?', 'All chapters saved for offline reading will be removed.', () =>
                deleteDownload.all.mutate(undefined, {
                  onError: () =>
                    Alert.alert('Couldn’t clear downloads', 'Some files couldn’t be removed. Try again.'),
                }),
              )
            }
          />
          <ActionRow
            label="Clear reading progress"
            danger
            onPress={() =>
              confirm('Clear reading progress?', 'Continue Reading and all positions will be removed.', () =>
                clearProgress.mutate(),
              )
            }
          />
          <ActionRow
            label="Clear library"
            danger
            onPress={() =>
              confirm('Clear library?', 'All saved titles and favourites will be removed.', () =>
                clearLib.mutate(),
              )
            }
          />
        </Section>

</>}
        {sheet === 'about' && <>        {/* ---------- About ---------- */}
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
</>}
      </ScrollView>
    </BottomSheet>
  </>;

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
  icon,
  label,
  value,
  onChange,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.settingLabel}>{icon && <Ionicons name={icon} size={21} color={colors.textMuted} />}<Text style={[styles.rowLabelInline, { flexShrink: 1 }]}>{label}</Text></View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        {...(Platform.OS === 'web' ? { activeThumbColor: '#241006', activeTrackColor: colors.accent } : {})}
        accessibilityLabel={label}
        thumbColor={value ? '#241006' : colors.textMuted}
      />
    </View>
  );
}

function ActionRow({
  icon,
  disabled,
  label,
  value,
  danger,
  onPress,
}: {
  label: string;
  value?: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && { opacity: 0.4 }]} onPress={onPress}>
      <View style={styles.settingLabel}>{icon && <Ionicons name={icon} size={21} color={colors.textMuted} />}<Text style={[styles.rowLabelInline, { flexShrink: 1 }, danger && { color: colors.danger }]}>{label}</Text></View>
      <View style={styles.rowRight}>
        {value ? <Text numberOfLines={2} style={styles.rowValue}>{value}</Text> : null}
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
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 22, gap: 8 },
  headingText: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, color: colors.text },
  backButton: { width: 36, height: 44, justifyContent: 'center' },
  preview: { marginHorizontal: 16, padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.card, marginBottom: 24 },
  previewBook: { width: 52, height: 68, borderRadius: 7, borderWidth: 4, borderColor: '#E4DEF5', gap: 4, padding: 2 },
  previewPage: { flex: 1, backgroundColor: '#383050', borderRadius: 2 },
  previewTitle: { ...typography.bodyStrong, color: colors.text },
  previewCaption: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  settingLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  storageHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  storageSize: { ...typography.bodyStrong, color: colors.text },
  storageTrack: { height: 5, borderRadius: 3, marginHorizontal: 16, backgroundColor: colors.border, overflow: 'hidden' },
  storageFill: { height: '100%', backgroundColor: colors.accent },
  storageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  manageButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40 },
  manageText: { ...typography.caption, fontWeight: '700', color: colors.accent },
  screen: { flex: 1, backgroundColor: colors.bg },
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted, letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.cardPressed },
  sourceRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sourceLangs: { ...typography.caption, color: colors.textFaint, marginTop: 1 },
  rowLabelInline: { ...typography.body, color: colors.text },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '47%', marginLeft: 8, flexShrink: 1 },
  rowValue: { ...typography.caption, color: colors.textMuted, flexShrink: 1, textAlign: 'right' },
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
