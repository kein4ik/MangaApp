import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { imageSource } from '@/lib/imageSource';
import { cleanDescription } from '@/lib/text';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
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
  useDeadChapters,
  useMangaProgress,
  useMarkChaptersRead,
  useMatches,
  useReadableFallback,
  useReadChapters,
  useReadChapterNumbers,
  useSetLibraryStatus,
  useWorkPref,
  useSourcesQuery,
  useToggleFavorite,
  useToggleLibrary,
} from '@/data/queries';
import { linkWork, normChapterNumber, setWorkPref, type LibraryStatus } from '@/data/local/db';
import type { Chapter } from '@/data/sources/types';
import { isWorkDead } from '@/lib/sourceFilter';
import { languageLabel } from '@/components/languages';
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
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { id: routeId, sourceId: routeSourceId } = useLocalSearchParams<{
    id: string;
    sourceId: string;
  }>();
  const { language, enabledLanguages, hiddenSources } = useSettings();

  // The source we're currently reading this work on. Starts from the route,
  // but can be switched in place to any other source the work lives on.
  const [sourceId, setSourceId] = useState(routeSourceId);
  const [id, setId] = useState(routeId);
  const [lang, setLang] = useState(language);

  const details = useMangaDetails(sourceId, id);
  const sources = useSourcesQuery();
  const source = sources.data?.find((s) => s.id === sourceId);
  const canRead = source?.supportsReading ?? true;
  // Only the enabled content languages (en/ru), not every language the source lists.
  const sourceLangs = (source?.languages ?? []).filter((l) => enabledLanguages.includes(l));

  // Only fetch chapters from sources that can actually serve readable pages.
  const chapters = useChapters(sourceId, id, lang);
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
  const matches = useMatches(details.data, sourceId, enabledLanguages, hiddenSources);
  const crossProgress = useCrossSourceProgress(matches.data);
  const [statusOpen, setStatusOpen] = useState(false);

  // The full set of sources this work is available on (route entry + every
  // match found from whichever source is active), accumulated and de-duped so
  // the switcher stays stable while you flip between sources.
  type Variant = { sourceId: string; externalId: string; title: string; coverUrl?: string };
  const [variants, setVariants] = useState<Variant[]>([
    { sourceId: routeSourceId, externalId: routeId, title: '' },
  ]);

  useEffect(() => {
    setVariants((prev) => {
      const map = new Map(prev.map((v) => [`${v.sourceId}:${v.externalId}`, v]));
      if (details.data) {
        map.set(`${sourceId}:${id}`, {
          sourceId,
          externalId: id,
          title: details.data.title,
          coverUrl: details.data.coverUrl,
        });
      }
      for (const mt of matches.data ?? []) {
        const key = `${mt.sourceId}:${mt.externalId}`;
        if (!map.has(key)) {
          map.set(key, {
            sourceId: mt.sourceId,
            externalId: mt.externalId,
            title: mt.title,
            coverUrl: mt.coverUrl,
          });
        }
      }
      return [...map.values()];
    });
  }, [details.data, matches.data, sourceId, id]);

  // Persist the grouping so library/favourite/status treat this as one work.
  const linkedSig = useRef('');
  useEffect(() => {
    if (variants.length < 2) return;
    const sig = variants
      .map((v) => `${v.sourceId}:${v.externalId}`)
      .sort()
      .join('|');
    if (sig === linkedSig.current) return;
    linkedSig.current = sig;
    linkWork(
      variants.map((v, i) => ({
        sourceId: v.sourceId,
        externalId: v.externalId,
        primary: i === 0,
      })),
    ).then(() => {
      qc.invalidateQueries({ queryKey: ['library-status'] });
      qc.invalidateQueries({ queryKey: ['library'] });
    });
  }, [variants, qc]);

  // Remember the user's chosen source+language for this work so the next open
  // defaults to it. `prefApplied` stops the saved pref from overriding a manual
  // choice the user just made.
  const pref = useWorkPref(routeSourceId, routeId);
  const prefApplied = useRef(false);

  const savePref = (src: string, ext: string, language: string) => {
    prefApplied.current = true;
    setWorkPref(src, ext, { source: src, external: ext, language }).then(() =>
      qc.invalidateQueries({ queryKey: ['work-pref'] }),
    );
  };

  const switchSource = (v: { sourceId: string; externalId: string }, persist = true) => {
    if (v.sourceId === sourceId && v.externalId === id) return;
    const src = sources.data?.find((s) => s.id === v.sourceId);
    const newLang = src && !src.languages.includes(lang) ? src.languages[0] ?? 'en' : lang;
    setSourceId(v.sourceId);
    setId(v.externalId);
    if (newLang !== lang) setLang(newLang);
    if (persist) savePref(v.sourceId, v.externalId, newLang);
  };

  const pickLang = (code: string) => {
    setLang(code);
    savePref(sourceId, id, code);
  };

  // Apply the saved preference once on open (auto-switch to the preferred source).
  useEffect(() => {
    if (prefApplied.current || !pref.data) return;
    prefApplied.current = true;
    const p = pref.data;
    if (p.source_id !== sourceId || p.external_id !== id) {
      setSourceId(p.source_id);
      setId(p.external_id);
    }
    if (p.language && p.language !== lang) setLang(p.language);
  }, [pref.data, sourceId, id, lang]);

  // Active source loaded but empty (often a licensed title) → find a source that
  // actually has chapters, so we can offer it instead of a dead end.
  const activeEmpty = canRead && !chapters.isLoading && (chapters.data?.length ?? 0) === 0;
  const fallback = useReadableFallback(variants, sourceId, id, activeEmpty);

  // "Read on" hides sources confirmed empty (no readable chapters), but always
  // keeps the source you're currently on. Linking/fallback still use all variants.
  const deadChapters = useDeadChapters();
  const displayVariants = useMemo(() => {
    const deadKeys = new Set(deadChapters.data ?? []);
    return variants.filter((v) => {
      if (v.sourceId === sourceId && v.externalId === id) return true;
      const langs = (sources.data?.find((s) => s.id === v.sourceId)?.languages ?? []).filter((l) =>
        enabledLanguages.includes(l),
      );
      return !isWorkDead(deadKeys, v.sourceId, v.externalId, langs);
    });
  }, [variants, deadChapters.data, sources.data, enabledLanguages, sourceId, id]);

  // Read/unread tracking. `readSet` = exact chapter ids on this source;
  // `readNums` = chapter numbers read across the whole group (cross-source).
  const readChapters = useReadChapters(sourceId, id);
  const readNumbers = useReadChapterNumbers(sourceId, id);
  const markRead = useMarkChaptersRead(sourceId, id);
  const readSet = useMemo(() => new Set(readChapters.data ?? []), [readChapters.data]);
  const readNums = useMemo(() => new Set(readNumbers.data ?? []), [readNumbers.data]);
  const isChapterRead = (c: Chapter) =>
    readSet.has(c.externalId) || readNums.has(normChapterNumber(c.chapterNumber) ?? '\0');

  // Returning from the reader: refresh read state + progress (a finished chapter
  // auto-marks read, and this screen stays mounted under the reader).
  useFocusEffect(
    useCallback(() => {
      readChapters.refetch();
      readNumbers.refetch();
      progress.refetch();
    }, [readChapters.refetch, readNumbers.refetch, progress.refetch]),
  );

  // Long-press a chapter → mark everything up to and including it as read.
  const markUpTo = (chapter: Chapter) => {
    const list = chapters.data ?? [];
    const i = list.findIndex((c) => c.externalId === chapter.externalId);
    if (i < 0) return;
    const items = list
      .slice(0, i + 1)
      .map((c) => ({ chapterId: c.externalId, chapterNumber: c.chapterNumber }));
    Alert.alert(
      'Mark as read',
      `Mark ${items.length} chapter${items.length > 1 ? 's' : ''} up to ${
        chapter.chapterNumber ? `chapter ${chapter.chapterNumber}` : 'here'
      } as read?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark read', onPress: () => markRead.mutate({ items, read: true }) },
      ],
    );
  };

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
      details.data.authors?.[0],
      details.data.year ? String(details.data.year) : undefined,
      details.data.status,
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
  const hasChapters = (chapters.data?.length ?? 0) > 0;
  const readTarget = lastChapterId
    ? {
        id: lastChapterId,
        number: progress.data?.chapter_number,
        page: progress.data?.page_index,
        lang: progress.data?.language ?? lang,
      }
    : hasChapters
      ? {
          id: chapters.data![0].externalId,
          number: chapters.data![0].chapterNumber,
          page: 0,
          lang,
        }
      : null;
  const progressPercent = Math.round((progress.data?.percent ?? 0) * 100);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        style={styles.screen}
        data={canRead ? displayedChapters : []}
        keyExtractor={(c) => c.externalId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListHeaderComponent={
          <View>
            <View style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
              {m.coverUrl && (
                <Image
                  source={imageSource(m.coverUrl)}
                  style={styles.heroBackdrop}
                  contentFit="cover"
                  blurRadius={28}
                />
              )}
              <LinearGradient
                colors={['rgba(14,11,26,0.48)', 'rgba(14,11,26,0.82)', colors.bg]}
                locations={[0, 0.62, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroTopBar}>
                <Pressable
                  accessibilityLabel="Go back"
                  hitSlop={12}
                  style={styles.topIconBtn}
                  onPress={() => router.back()}
                >
                  <Ionicons name="arrow-back" size={23} color={colors.text} />
                </Pressable>
                <View style={styles.heroTopActions}>
                  <Pressable
                    accessibilityLabel="Share manga"
                    hitSlop={12}
                    style={styles.topIconBtn}
                    onPress={() => void Share.share({ message: m.title })}
                  >
                    <Ionicons name="share-social-outline" size={21} color={colors.text} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Manga options"
                    hitSlop={12}
                    style={styles.topIconBtn}
                    onPress={() => setStatusOpen(true)}
                  >
                    <Ionicons name="ellipsis-vertical" size={21} color={colors.text} />
                  </Pressable>
                </View>
              </View>
              {m.coverUrl && (
                <Image source={imageSource(m.coverUrl)} style={styles.cover} contentFit="cover" />
              )}
              <Text style={styles.title}>{m.title}</Text>
              {headerSubtitle ? <Text style={styles.subtitle}>{headerSubtitle}</Text> : null}
              {m.genres && m.genres.length > 0 && (
                <Text numberOfLines={1} style={styles.genres}>
                  {m.genres.slice(0, 3).join('  •  ')}
                </Text>
              )}
              <View style={styles.metaChips}>
                <View style={styles.metaChip}>
                  <View
                    style={[styles.metaChipDot, { backgroundColor: sourceMeta(sourceId).color }]}
                  />
                  <Text style={styles.metaChipText}>{source?.name ?? sourceMeta(sourceId).name}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.metaChipText}>{lang.toUpperCase()}</Text>
                </View>
              </View>
              {canRead && readTarget ? (
                <View style={styles.readProgressMeta}>
                  <Text style={styles.readProgressTitle}>
                    {readTarget.number ? `Chapter ${readTarget.number}` : 'Ready to read'}
                  </Text>
                  {lastChapterId ? (
                    <Text style={styles.readProgressCaption}>{progressPercent}% read</Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.actions}>
              {canRead && (
                <Pressable
                  disabled={!readTarget}
                  style={[styles.primaryBtn, !readTarget && styles.primaryBtnDisabled]}
                  onPress={() => {
                    if (!readTarget) return;
                    router.push({
                      pathname: '/reader/[chapterId]',
                      params: {
                        chapterId: readTarget.id,
                        sourceId,
                        mangaId: id,
                        chapterNumber: readTarget.number ?? '',
                        lang: readTarget.lang,
                        startPage: String(readTarget.page ?? 0),
                      },
                    });
                  }}
                >
                  <Ionicons
                    name="play"
                    size={17}
                    color={readTarget ? '#1A0E06' : colors.textFaint}
                  />
                  <Text style={[styles.primaryBtnText, !readTarget && styles.primaryBtnTextDisabled]}>
                    {lastChapterId
                      ? 'Continue Reading'
                      : hasChapters
                        ? 'Start Reading'
                        : 'No chapters'}
                  </Text>
                </Pressable>
              )}
              <View style={styles.secondaryActions}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => toggleFavorite.mutate(!libStatus.data?.favorite)}
                >
                  <Ionicons
                    name={libStatus.data?.favorite ? 'heart' : 'heart-outline'}
                    size={19}
                    color={libStatus.data?.favorite ? colors.accent : colors.textMuted}
                  />
                  <Text style={styles.secondaryBtnText}>Favorite</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={() => setStatusOpen(true)}>
                  <Ionicons
                    name={libStatus.data?.inLibrary ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={libStatus.data?.inLibrary ? colors.accent : colors.textMuted}
                  />
                  <Text style={styles.secondaryBtnText} numberOfLines={1}>
                    {libStatus.data?.inLibrary
                      ? STATUS_LABELS[(libStatus.data.status as LibraryStatus) ?? 'reading'] ??
                        'In Library'
                      : 'Add to Library'}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={colors.textFaint} />
                </Pressable>
              </View>
            </View>

            {!canRead && (
              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerText}>
                  {source?.name ?? 'This source'} provides info only. Switch to a reading
                  source (e.g. MangaDex) to read this title.
                </Text>
              </View>
            )}

            {/* Active source is empty → offer one that actually has chapters. */}
            {activeEmpty && fallback.isLoading && (
              <View style={styles.fallbackChecking}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.fallbackCheckingText}>Finding a source with chapters…</Text>
              </View>
            )}
            {activeEmpty && fallback.data && (
              <Pressable
                style={styles.crossBanner}
                onPress={() =>
                  switchSource({
                    sourceId: fallback.data!.sourceId,
                    externalId: fallback.data!.externalId,
                  })
                }
              >
                <Text style={styles.crossBannerText}>
                  No readable chapters on {source?.name ?? sourceId}
                </Text>
                <Text style={styles.crossBannerCta}>
                  Read on {sourceMeta(fallback.data.sourceId).name} ({fallback.data.count} chapters) ›
                </Text>
              </Pressable>
            )}

            {(displayVariants.length > 1 || sourceLangs.length > 1) && (
              <View style={styles.availWrap}>
                {displayVariants.length > 1 && (
                  <>
                    <Text style={styles.availTitle}>Read on</Text>
                    <View style={styles.switchRow}>
                      {displayVariants.map((v) => {
                        const activeSrc = v.sourceId === sourceId && v.externalId === id;
                        const meta = sourceMeta(v.sourceId);
                        const name =
                          sources.data?.find((s) => s.id === v.sourceId)?.name ?? meta.name;
                        return (
                          <Pressable
                            key={`${v.sourceId}:${v.externalId}`}
                            style={[styles.switchChip, activeSrc && styles.switchChipActive]}
                            onPress={() => switchSource(v)}
                          >
                            <View style={[styles.availDot, { backgroundColor: meta.color }]} />
                            <Text
                              style={[styles.switchText, activeSrc && { color: colors.accent }]}
                            >
                              {name}
                            </Text>
                            {activeSrc && (
                              <Ionicons name="checkmark" size={14} color={colors.accent} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                {sourceLangs.length > 1 && (
                  <>
                    <Text style={[styles.availTitle, { marginTop: spacing.md }]}>Language</Text>
                    <View style={styles.switchRow}>
                      {sourceLangs.map((code) => {
                        const activeLang = code === lang;
                        return (
                          <Pressable
                            key={code}
                            style={[styles.switchChip, activeLang && styles.switchChipActive]}
                            onPress={() => pickLang(code)}
                          >
                            <Text
                              style={[styles.switchText, activeLang && { color: colors.accent }]}
                            >
                              {languageLabel(code)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            )}

            {cleanDescription(m.description) ? (
              <Text style={styles.description}>{cleanDescription(m.description)}</Text>
            ) : null}

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
                      lang,
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
                      <Ionicons name="search-outline" size={17} color={colors.textFaint} />
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
                          <Ionicons name="close" size={18} color={colors.textFaint} />
                        </Pressable>
                      )}
                    </View>
                    <Pressable
                      style={styles.orderBtn}
                      onPress={() => setNewestFirst((v) => !v)}
                    >
                      <Ionicons
                        name={newestFirst ? 'arrow-down' : 'arrow-up'}
                        size={15}
                        color={colors.textMuted}
                      />
                      <Text style={styles.orderText}>{newestFirst ? 'New' : 'Old'}</Text>
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
          const isRead = isChapterRead(item);
          return (
            <Pressable
              style={({ pressed }) => [styles.chapterRow, pressed && styles.chapterRowPressed]}
              onLongPress={() => markUpTo(item)}
              onPress={() =>
                router.push({
                  pathname: '/reader/[chapterId]',
                  params: {
                    chapterId: item.externalId,
                    sourceId,
                    mangaId: id,
                    chapterNumber: item.chapterNumber ?? '',
                    lang,
                    startPage: '0',
                  },
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.chapterTitle,
                    isRead && styles.chapterRead,
                    isCurrent && { color: colors.accent },
                  ]}
                >
                  {item.chapterNumber ? `Chapter ${item.chapterNumber}` : item.title || 'Oneshot'}
                </Text>
                {item.scanlationGroup ? (
                  <Text style={styles.chapterMeta}>{item.scanlationGroup}</Text>
                ) : null}
              </View>
              {isCurrent && <Text style={styles.currentTag}>reading</Text>}
              <Pressable
                hitSlop={12}
                style={styles.readToggle}
                onPress={() =>
                  markRead.mutate({
                    items: [{ chapterId: item.externalId, chapterNumber: item.chapterNumber }],
                    read: !isRead,
                  })
                }
              >
                <Ionicons
                  name={isRead ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={isRead ? colors.accent : colors.textFaint}
                />
              </Pressable>
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

  hero: {
    alignItems: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  heroBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.34,
    transform: [{ scale: 1.12 }],
  },
  heroTopBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroTopActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  topIconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,11,26,0.34)',
  },
  cover: {
    width: 128,
    height: 186,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: '94%',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    textTransform: 'capitalize',
  },
  genres: {
    ...typography.caption,
    color: colors.purple,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: '90%',
  },
  metaChips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(30,27,48,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  metaChipDot: { width: 7, height: 7, borderRadius: radius.pill },
  metaChipText: { ...typography.caption, color: colors.text },
  readProgressMeta: { alignItems: 'center', gap: 3, marginTop: spacing.md },
  readProgressTitle: { ...typography.bodyStrong, color: colors.text },
  readProgressCaption: { ...typography.caption, color: colors.textMuted },

  actions: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  primaryBtn: {
    width: '100%',
    height: 50,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: colors.card },
  primaryBtnText: { ...typography.bodyStrong, color: '#1A0E06' },
  primaryBtnTextDisabled: { color: colors.textFaint },
  secondaryActions: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    minWidth: 0,
    height: 46,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { ...typography.bodyStrong, color: colors.text },

  availWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  availTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  availRow: { gap: spacing.sm },
  availChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  availCover: {
    width: 36,
    height: 50,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
  },
  availCoverFallback: { opacity: 0.45 },
  availInfo: { flex: 1, gap: 3 },
  availSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  availDot: { width: 7, height: 7, borderRadius: radius.pill },
  availSource: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  availConfidence: {
    ...typography.tiny,
    color: colors.textFaint,
    marginLeft: 'auto',
    textTransform: 'uppercase',
  },
  availMatchTitle: { ...typography.bodyStrong, color: colors.text },
  switchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchChipActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  switchText: { ...typography.caption, color: colors.text, fontWeight: '600' },
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
    flexDirection: 'row',
    gap: 5,
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
  chapterRead: { color: colors.textFaint },
  readToggle: { paddingLeft: spacing.md },
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
  fallbackChecking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  fallbackCheckingText: { ...typography.caption, color: colors.textMuted },
});
