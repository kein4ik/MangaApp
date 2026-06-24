import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { imageSource } from '@/lib/imageSource';
import { cleanDescription } from '@/lib/text';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useChapters,
  useCrossSourceProgress,
  useLibraryStatus,
  useMangaDetails,
  useMangaProgress,
  useMatches,
  useSetLibraryStatus,
  useSourcesQuery,
  useToggleFavorite,
  useToggleLibrary,
} from '@/data/queries';
import type { LibraryStatus } from '@/data/local/db';
import type { Chapter } from '@/data/sources/types';
import { BottomSheet } from '@/components/BottomSheet';
import { sourceMeta } from '@/lib/sourceMeta';
import { useSettings } from '@/store/settings.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const STATUS_LABELS: Record<LibraryStatus, string> = {
  reading: 'Reading',
  plan: 'Plan to read',
  on_hold: 'On hold',
  completed: 'Completed',
  dropped: 'Dropped',
};
const STATUS_KEYS = Object.keys(STATUS_LABELS) as LibraryStatus[];

export default function MangaDetailsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, sourceId } = useLocalSearchParams<{ id: string; sourceId: string }>();
  const { language } = useSettings();

  const details = useMangaDetails(sourceId, id);
  const sources = useSourcesQuery();
  const source = sources.data?.find((s) => s.id === sourceId);
  const canRead = source?.supportsReading ?? true;

  // Only fetch chapters from sources that can actually serve readable pages.
  const chapters = useChapters(sourceId, id, language);
  const progress = useMangaProgress(sourceId, id);

  const mangaRef = {
    sourceId,
    externalId: id,
    title: details.data?.title ?? '',
    coverUrl: details.data?.coverUrl,
    description: details.data?.description,
    languages: details.data?.languages ?? [],
  };
  const toggleLibrary = useToggleLibrary(mangaRef);
  const libStatus = useLibraryStatus(sourceId, id);
  const toggleFavorite = useToggleFavorite(mangaRef);
  const setStatus = useSetLibraryStatus(sourceId, id, mangaRef);
  const matches = useMatches(details.data?.title, sourceId);
  const crossProgress = useCrossSourceProgress(matches.data);
  const [statusOpen, setStatusOpen] = useState(false);

  const lastChapterId = progress.data?.chapter_id;

  // Chapter filter + order — essential for long series (One Piece = 1000+).
  const [chapterQuery, setChapterQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const displayedChapters = useMemo(() => {
    let list = chapters.data ?? [];
    const q = chapterQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.chapterNumber ?? '').toLowerCase().includes(q) ||
          (c.title ?? '').toLowerCase().includes(q),
      );
    }
    return newestFirst ? [...list].reverse() : list;
  }, [chapters.data, chapterQuery, newestFirst]);

  // Cross-source resume: read elsewhere but not here → find the closest chapter.
  const crossResume = useMemo(() => {
    if (lastChapterId || !crossProgress.data || !chapters.data?.length) return null;
    const target = crossProgress.data.num;
    let best: Chapter | null = null;
    let bestDiff = Infinity;
    for (const c of chapters.data) {
      const n = Number(c.chapterNumber);
      if (isNaN(n)) continue;
      const d = Math.abs(n - target);
      if (d < bestDiff) {
        bestDiff = d;
        best = c;
      }
    }
    return best ? { chapter: best, from: crossProgress.data } : null;
  }, [lastChapterId, crossProgress.data, chapters.data]);

  const headerSubtitle = useMemo(() => {
    if (!details.data) return '';
    const parts = [
      details.data.status,
      details.data.year ? String(details.data.year) : undefined,
      details.data.authors?.[0],
    ].filter(Boolean);
    return parts.join(' · ');
  }, [details.data]);

  if (details.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (details.isError || !details.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Couldn’t load this title.</Text>
      </View>
    );
  }

  const m = details.data;

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <FlatList
        style={styles.screen}
        data={canRead ? displayedChapters : []}
        keyExtractor={(c) => c.externalId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              {m.coverUrl && (
                <Image source={imageSource(m.coverUrl)} style={styles.cover} contentFit="cover" />
              )}
              <View style={styles.heroInfo}>
                <Text style={styles.title}>{m.title}</Text>
                <Text style={styles.subtitle}>{headerSubtitle}</Text>
                {m.genres && m.genres.length > 0 && (
                  <Text numberOfLines={2} style={styles.genres}>
                    {m.genres.slice(0, 4).join(' • ')}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.actions}>
              {canRead &&
                (() => {
                  const hasChapters = (chapters.data?.length ?? 0) > 0;
                  const canRead2 = Boolean(lastChapterId) || hasChapters;
                  return (
                    <Pressable
                      disabled={!canRead2}
                      style={[styles.primaryBtn, !canRead2 && styles.primaryBtnDisabled]}
                      onPress={() => {
                        const target = lastChapterId
                          ? {
                              id: lastChapterId,
                              number: progress.data?.chapter_number,
                              page: progress.data?.page_index,
                              lang: progress.data?.language ?? language,
                            }
                          : hasChapters
                            ? {
                                id: chapters.data![0].externalId,
                                number: chapters.data![0].chapterNumber,
                                page: 0,
                                lang: language,
                              }
                            : null;
                        if (!target) return;
                        router.push({
                          pathname: '/reader/[chapterId]',
                          params: {
                            chapterId: target.id,
                            sourceId,
                            mangaId: id,
                            chapterNumber: target.number ?? '',
                            lang: target.lang,
                            startPage: String(target.page ?? 0),
                          },
                        });
                      }}
                    >
                      <Text
                        style={[styles.primaryBtnText, !canRead2 && styles.primaryBtnTextDisabled]}
                      >
                        {lastChapterId
                          ? 'Continue Reading'
                          : hasChapters
                            ? 'Start Reading'
                            : 'No chapters'}
                      </Text>
                    </Pressable>
                  );
                })()}
              <Pressable
                style={styles.iconBtn}
                onPress={() => toggleFavorite.mutate(!libStatus.data?.favorite)}
              >
                <Text style={[styles.iconBtnText, libStatus.data?.favorite && { color: colors.accent }]}>
                  {libStatus.data?.favorite ? '♥' : '♡'}
                </Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setStatusOpen(true)}>
                <Text style={styles.secondaryBtnText}>
                  {libStatus.data?.inLibrary
                    ? STATUS_LABELS[(libStatus.data.status as LibraryStatus) ?? 'reading'] ?? 'In Library'
                    : '+ Library'}{' '}
                  ▾
                </Text>
              </Pressable>
            </View>

            {!canRead && (
              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerText}>
                  {source?.name ?? 'This source'} provides info only. Switch to a reading
                  source (e.g. MangaDex) to read this title.
                </Text>
              </View>
            )}

            {cleanDescription(m.description) ? (
              <Text style={styles.description}>{cleanDescription(m.description)}</Text>
            ) : null}

            {matches.data && matches.data.length > 0 && (
              <View style={styles.availWrap}>
                <Text style={styles.availTitle}>Also available on</Text>
                <View style={styles.availRow}>
                  {matches.data.map((mt) => (
                    <Pressable
                      key={mt.sourceId}
                      style={styles.availChip}
                      onPress={() =>
                        router.push({
                          pathname: '/manga/[id]',
                          params: { id: mt.externalId, sourceId: mt.sourceId },
                        })
                      }
                    >
                      <View
                        style={[styles.availDot, { backgroundColor: sourceMeta(mt.sourceId).color }]}
                      />
                      <Text style={styles.availChipText}>{sourceMeta(mt.sourceId).name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {crossResume && (
              <Pressable
                style={styles.crossBanner}
                onPress={() =>
                  router.push({
                    pathname: '/reader/[chapterId]',
                    params: {
                      chapterId: crossResume.chapter.externalId,
                      sourceId,
                      mangaId: id,
                      chapterNumber: crossResume.chapter.chapterNumber ?? '',
                      lang: language,
                      startPage: '0',
                    },
                  })
                }
              >
                <Text style={styles.crossBannerText}>
                  You’re at chapter {crossResume.from.chapterNumber} on{' '}
                  {sourceMeta(crossResume.from.sourceId).name}
                </Text>
                <Text style={styles.crossBannerCta}>
                  Resume here from ch. {crossResume.chapter.chapterNumber} ›
                </Text>
              </Pressable>
            )}

            {canRead && (
              <>
                <Text style={styles.chaptersHeading}>
                  Chapters {chapters.data ? `(${chapters.data.length})` : ''}
                </Text>
                {chapters.data && chapters.data.length > 0 && (
                  <View style={styles.chapterTools}>
                    <View style={styles.chapterSearch}>
                      <Text style={{ color: colors.textFaint }}>🔍</Text>
                      <TextInput
                        value={chapterQuery}
                        onChangeText={setChapterQuery}
                        placeholder="Find chapter…"
                        placeholderTextColor={colors.textFaint}
                        keyboardType="numbers-and-punctuation"
                        style={styles.chapterSearchInput}
                      />
                      {chapterQuery.length > 0 && (
                        <Pressable onPress={() => setChapterQuery('')} hitSlop={8}>
                          <Text style={{ color: colors.textFaint }}>✕</Text>
                        </Pressable>
                      )}
                    </View>
                    <Pressable
                      style={styles.orderBtn}
                      onPress={() => setNewestFirst((v) => !v)}
                    >
                      <Text style={styles.orderText}>{newestFirst ? '↓ New' : '↑ Old'}</Text>
                    </Pressable>
                  </View>
                )}
                {chapters.isLoading && (
                  <ActivityIndicator
                    color={colors.accent}
                    style={{ marginVertical: spacing.md }}
                  />
                )}
                {chapters.data && chapters.data.length === 0 && !chapters.isLoading && (
                  <Text style={styles.muted}>
                    No readable chapters here. {source?.name ?? 'This source'} may have
                    licensed this title (chapters link out). Try another source from the
                    Sources tab — popular titles often read on Mangapill, MangaLib or Remanga.
                  </Text>
                )}
                {chapters.data && chapters.data.length > 0 && displayedChapters.length === 0 && (
                  <Text style={styles.muted}>No chapter matches “{chapterQuery}”.</Text>
                )}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isCurrent = item.externalId === lastChapterId;
          return (
            <Pressable
              style={({ pressed }) => [styles.chapterRow, pressed && styles.chapterRowPressed]}
              onPress={() =>
                router.push({
                  pathname: '/reader/[chapterId]',
                  params: {
                    chapterId: item.externalId,
                    sourceId,
                    mangaId: id,
                    chapterNumber: item.chapterNumber ?? '',
                    lang: language,
                    startPage: '0',
                  },
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.chapterTitle, isCurrent && { color: colors.accent }]}>
                  {item.chapterNumber ? `Chapter ${item.chapterNumber}` : item.title || 'Oneshot'}
                </Text>
                {item.scanlationGroup ? (
                  <Text style={styles.chapterMeta}>{item.scanlationGroup}</Text>
                ) : null}
              </View>
              {isCurrent && <Text style={styles.currentTag}>reading</Text>}
            </Pressable>
          );
        }}
      />

      <BottomSheet visible={statusOpen} title="Status" onClose={() => setStatusOpen(false)}>
        {STATUS_KEYS.map((key) => {
          const active = libStatus.data?.inLibrary && (libStatus.data.status ?? 'reading') === key;
          return (
            <Pressable
              key={key}
              style={[styles.statusRow, active && styles.statusRowActive]}
              onPress={() => {
                setStatus.mutate(key);
                setStatusOpen(false);
              }}
            >
              <Text style={[styles.statusRowText, active && { color: colors.accent }]}>
                {STATUS_LABELS[key]}
              </Text>
              {active && <Text style={styles.statusCheck}>✓</Text>}
            </Pressable>
          );
        })}
        {libStatus.data?.inLibrary && (
          <Pressable
            style={styles.statusRow}
            onPress={() => {
              toggleLibrary.mutate(true);
              setStatusOpen(false);
            }}
          >
            <Text style={[styles.statusRowText, { color: colors.danger }]}>Remove from library</Text>
          </Pressable>
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  error: { ...typography.body, color: colors.danger },
  muted: { ...typography.body, color: colors.textMuted, paddingHorizontal: spacing.lg },

  hero: { flexDirection: 'row', gap: spacing.lg, padding: spacing.lg },
  cover: { width: 120, height: 174, borderRadius: radius.md, backgroundColor: colors.card },
  heroInfo: { flex: 1, justifyContent: 'flex-end', gap: spacing.xs },
  title: { ...typography.h2, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted, textTransform: 'capitalize' },
  genres: { ...typography.caption, color: colors.purple },

  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg },
  primaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: colors.card },
  primaryBtnText: { ...typography.bodyStrong, color: '#1A0E06' },
  primaryBtnTextDisabled: { color: colors.textFaint },
  secondaryBtn: {
    paddingHorizontal: spacing.lg,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { ...typography.bodyStrong, color: colors.text },
  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 20, color: colors.textMuted },

  availWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  availTitle: { ...typography.caption, color: colors.textFaint, marginBottom: spacing.sm, textTransform: 'uppercase' },
  availRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  availChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  availDot: { width: 7, height: 7, borderRadius: radius.pill },
  availChipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  infoBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderLeftWidth: 3,
    borderLeftColor: colors.purple,
  },
  infoBannerText: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  description: {
    ...typography.body,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    lineHeight: 21,
  },
  chaptersHeading: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  chapterTools: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chapterSearch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  chapterSearchInput: { flex: 1, color: colors.text, ...typography.body },
  orderBtn: {
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderText: { ...typography.bodyStrong, color: colors.text },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chapterRowPressed: { backgroundColor: colors.cardPressed },
  chapterTitle: { ...typography.body, color: colors.text },
  chapterMeta: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  currentTag: { ...typography.tiny, color: colors.accent, textTransform: 'uppercase' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  statusRowActive: { backgroundColor: colors.card },
  statusRowText: { ...typography.body, color: colors.text },
  statusCheck: { ...typography.bodyStrong, color: colors.accent },
  crossBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    gap: 3,
  },
  crossBannerText: { ...typography.caption, color: colors.textMuted },
  crossBannerCta: { ...typography.bodyStrong, color: colors.accent },
});
