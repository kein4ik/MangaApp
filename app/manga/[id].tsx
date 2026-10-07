import { CoverArt } from '@/components/CoverArt';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';

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
  useCachedMangaDetails,
  useChapters,
  useCrossSourceProgress,
  useLibraryStatus,
  useMangaDetails,
  useOfflineChapters,
  useDeadChapters,
  useMangaProgress,
  useMarkChaptersRead,
  useMatches,
  useReadableFallback,
  useReadChapters,
  useReadChapterNumbers,
  useDeleteDownload,
  useDownloadChapter,
  useDownloadedChapters,
  useSetLibraryStatus,
  useSimilar,
  sourceSupportsGenres,
  useWorkPref,
  useSourcesQuery,
  useToggleFavorite,
  useToggleLibrary,
} from '@/data/queries';
import { linkWork, normChapterNumber, setWorkPref, type LibraryStatus } from '@/data/local/db';
import { HttpError } from '@/data/sources/http';
import { SourceRegistry } from '@/data/sources/registry';
import type { Chapter } from '@/data/sources/types';
import { chapterNeighbours } from '@/lib/chapters';
import { isWorkDead } from '@/lib/sourceFilter';
import { languageLabel } from '@/components/languages';
import { BottomSheet } from '@/components/BottomSheet';
import { MangaCard } from '@/components/MangaCard';
import { sourceMeta } from '@/lib/sourceMeta';
import { hapticSuccess, hapticTap } from '@/lib/haptics';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { downloadKey, useDownloadProgress } from '@/store/downloads.store';
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
  const router = useGuardedRouter();
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
  // Start in a language THIS source serves (an English-only source opened
  // while the app language is Russian used to be labelled/saved as "ru").
  const [lang, setLang] = useState(() => {
    const served = SourceRegistry.get(routeSourceId)?.languages ?? [];
    if (served.length === 0 || served.includes(language)) return language;
    return served.find((l) => enabledLanguages.includes(l)) ?? served[0];
  });

  const details = useMangaDetails(sourceId, id);
  // Offline and nothing cached in memory: fall back to the title as stored on
  // the device, so downloaded chapters stay reachable without network.
  const cachedDetails = useCachedMangaDetails(sourceId, id, details.isError && !details.data);
  const manga = details.data ?? cachedDetails.data ?? undefined;
  const sources = useSourcesQuery();
  const source = sources.data?.find((s) => s.id === sourceId);
  const canRead = source?.supportsReading ?? true;
  // Only the enabled content languages (en/ru), not every language the source lists.
  const sourceLangs = (source?.languages ?? []).filter((l) => enabledLanguages.includes(l));

  // Only fetch chapters from sources that can actually serve readable pages.
  const chapters = useChapters(sourceId, id, lang);
  // Chapter list failed (offline / source down) → show what's downloaded.
  const offlineChapters = useOfflineChapters(sourceId, id, chapters.isError && !chapters.data);
  const chapterList: Chapter[] | undefined = chapters.data ?? offlineChapters.data;
  const showingOffline = !chapters.data && !!offlineChapters.data?.length;
  const progress = useMangaProgress(sourceId, id);

  const mangaRef = {
    sourceId,
    externalId: id,
    title: manga?.title ?? '',
    coverUrl: manga?.coverUrl,
    description: manga?.description,
    languages: manga?.languages ?? [],
  };
  const toggleLibrary = useToggleLibrary(mangaRef);
  const libStatus = useLibraryStatus(sourceId, id);
  const toggleFavorite = useToggleFavorite(mangaRef);
  const setStatus = useSetLibraryStatus(sourceId, id, mangaRef);
  // Secondary discovery queries wait for the primary content (chapters) so the
  // first seconds of the screen aren't a burst of a dozen parallel fetches —
  // that burst blocked the JS thread and made the Read button eat first taps.
  const contentReady = chapters.isFetched;
  const matches = useMatches(
    contentReady ? details.data : undefined,
    sourceId,
    enabledLanguages,
    hiddenSources,
  );
  const crossProgress = useCrossSourceProgress(matches.data);
  // Offline downloads for this title's chapters.
  const downloadedIds = useDownloadedChapters(sourceId, id);
  const dlSet = useMemo(() => new Set(downloadedIds.data ?? []), [downloadedIds.data]);
  const dlActive = useDownloadProgress((s) => s.active);
  const downloadChapter = useDownloadChapter(sourceId, id, lang);
  const deleteDownload = useDeleteDownload();

  const genresBrowsable = sourceSupportsGenres(sourceId);
  const similar = useSimilar(
    sourceId,
    genresBrowsable && contentReady ? details.data?.genres : undefined,
    id,
    lang,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

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

  // A saved preference can point at an entry that has since vanished (a title
  // removed from that site) — that used to strand the page on "Couldn't load".
  // Fall back to the source the user came from, and forget a preference that's
  // gone for good (404/410) so the next open goes straight to a working one.
  useEffect(() => {
    if (!details.isError || details.data) return;
    if (sourceId === routeSourceId && id === routeId) return;
    const served = SourceRegistry.get(routeSourceId)?.languages ?? [];
    const routeLang = served.includes(lang)
      ? lang
      : served.find((l) => enabledLanguages.includes(l)) ?? served[0] ?? lang;
    setSourceId(routeSourceId);
    setId(routeId);
    setLang(routeLang);
    const gone = details.error instanceof HttpError && [404, 410].includes(details.error.status);
    if (gone) savePref(routeSourceId, routeId, routeLang);
    // savePref is recreated each render; the ids/flags above are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.isError, details.data, details.error, sourceId, id, routeSourceId, routeId]);

  // Active source empty (often a licensed title) or unreachable → find a source
  // that actually has chapters, so we can offer it instead of a dead end.
  const chaptersFailed = chapters.isError && !chapters.data;
  const activeEmpty =
    canRead && ((chapters.isSuccess && chapters.data.length === 0) || chaptersFailed);
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
  const markRead = useMarkChaptersRead(sourceId, id, lang);
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
    const list = chapterList ?? [];
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

  // Where the user actually is: the chapter last OPENED in the reader. Chapters
  // only marked read never count as "current" (that used to hijack Continue).
  const lastOpened = progress.data?.opened_at ? progress.data : null;
  const lastChapterId = lastOpened?.chapter_id;

  // Chapter filter + order — essential for long series (One Piece = 1000+).
  const [chapterQuery, setChapterQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const displayedChapters = useMemo(() => {
    let list = chapterList ?? [];
    const q = chapterQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.chapterNumber ?? '').toLowerCase().includes(q) ||
          (c.title ?? '').toLowerCase().includes(q),
      );
    }
    return newestFirst ? [...list].reverse() : list;
  }, [chapterList, chapterQuery, newestFirst]);

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
    if (!manga) return '';
    const parts = [
      manga.authors?.[0],
      manga.year ? String(manga.year) : undefined,
      manga.status,
    ].filter(Boolean);
    return parts.join(' · ');
  }, [manga]);

  // What the primary button opens:
  // - mid-chapter → that chapter at the saved page (`resume`);
  // - finished (or marked) the chapter you were on → the first UNREAD chapter
  //   after it, not its last page again;
  // - never opened anything → the first chapter after the furthest one marked read.
  const readTarget = useMemo(() => {
    const list = chapterList ?? [];
    const firstUnreadAfter = (idx: number) => {
      for (let i = idx + 1; i < list.length; i++) if (!isChapterRead(list[i])) return list[i];
      return undefined;
    };
    if (lastOpened) {
      if (lastOpened.read) {
        const idx = list.findIndex((c) => c.externalId === lastOpened.chapter_id);
        const next =
          (idx >= 0 ? firstUnreadAfter(idx) : undefined) ??
          chapterNeighbours(list, lastOpened.chapter_id).next;
        if (next) {
          return {
            id: next.externalId,
            number: next.chapterNumber,
            page: 0,
            lang: next.language || lang,
            resume: false,
          };
        }
      }
      return {
        id: lastOpened.chapter_id,
        number: lastOpened.chapter_number ?? undefined,
        page: lastOpened.page_index,
        lang: lastOpened.language ?? lang,
        resume: true,
      };
    }
    let lastReadIdx = -1;
    list.forEach((c, i) => {
      if (isChapterRead(c)) lastReadIdx = i;
    });
    const target = list[lastReadIdx + 1] ?? list[lastReadIdx];
    return target
      ? { id: target.externalId, number: target.chapterNumber, page: 0, lang, resume: false }
      : null;
    // isChapterRead reads readSet/readNums, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterList, lastOpened, lang, readSet, readNums]);

  const fallingBack =
    details.isError && !details.data && (sourceId !== routeSourceId || id !== routeId);
  if (details.isLoading || fallingBack || (details.isError && cachedDetails.isLoading)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Only a hard dead end when there's nothing at all to show — cached details
  // survive a failed background refresh, and offline the device copy is used.
  if (!manga) {
    return (
      <View style={[styles.center, { gap: spacing.md }]}>
        <Text style={styles.error}>Couldn’t load this title.</Text>
        <Pressable style={styles.retryBtn} onPress={() => details.refetch()}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.backLink}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const m = manga;
  const resumeLabel =
    lastOpened || readSet.size > 0 || readNums.size > 0 ? 'Continue Reading' : 'Start Reading';
  const progressPercent = Math.round((lastOpened?.percent ?? 0) * 100);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {/* FlashList recycles rows — a 1000-chapter list scrolls without the
          stutter a plain FlatList showed when mounting every row. */}
      <FlashList
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
              <View style={styles.titleOverview}>
                <CoverArt uri={m.coverUrl} title={m.title} style={styles.cover} />
                <View style={styles.titleInfo}>
                  <Text style={styles.title}>{m.title}</Text>
                  {headerSubtitle ? <Text style={styles.subtitle}>{headerSubtitle}</Text> : null}
                  {!!m.genres?.length && <View style={styles.genreRow}>{m.genres.slice(0, 3).map(g => genresBrowsable ? <Pressable key={g} onPress={() => router.push({ pathname: '/browse', params: { genre: g } })}><Text style={styles.genrePillText}>{g}</Text></Pressable> : <Text key={g} style={styles.genrePillText}>{g}</Text>)}</View>}
                  <Pressable style={styles.metaChip} onPress={() => setSourceOpen(true)} accessibilityLabel="Choose title source"><View style={[styles.metaChipDot, { backgroundColor: sourceMeta(sourceId).color }]} /><Text numberOfLines={1} style={styles.metaChipText}>{source?.name ?? sourceMeta(sourceId).name} · {lang.toUpperCase()}</Text><Ionicons name="chevron-down" size={13} color={colors.textMuted} /></Pressable>
                  {displayVariants.length > 1 && <Pressable onPress={() => setSourceOpen(true)} style={styles.alsoOnButton}><Text style={styles.alsoOn} numberOfLines={2}>Also on <Text style={{ color: colors.text }}>{displayVariants.filter(v => v.sourceId !== sourceId || v.externalId !== id).map(v => sourceMeta(v.sourceId).name).join(' · ')}</Text></Text></Pressable>}
                </View>
              </View>
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
                    {readTarget
                      ? (readTarget.resume ? 'Continue' : resumeLabel === 'Start Reading' ? 'Start reading' : 'Continue') + (readTarget.number ? ' · Ch. ' + readTarget.number : '') + (readTarget.resume && readTarget.page ? ', p. ' + (readTarget.page + 1) : '')
                      : chapters.isLoading
                        ? 'Loading chapters…'
                        : 'No chapters'}
                  </Text>
                </Pressable>
              )}
              <View style={styles.secondaryActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => setStatusOpen(true)} accessibilityRole="button" accessibilityLabel="Choose library status">
                  <Ionicons
                    name={libStatus.data?.inLibrary ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={libStatus.data?.inLibrary ? colors.accent : colors.textMuted}
                  />
                  <Text style={styles.secondaryBtnText} numberOfLines={1}>
                    {libStatus.data?.inLibrary
                      ? STATUS_LABELS[(libStatus.data.status as LibraryStatus) ?? 'reading'] ??
                        'In Library'
                      : 'Save'}
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
                  {chaptersFailed
                    ? `Couldn’t reach ${source?.name ?? sourceId}`
                    : `No readable chapters on ${source?.name ?? sourceId}`}
                </Text>
                <Text style={styles.crossBannerCta}>
                  Read on {sourceMeta(fallback.data.sourceId).name} ({fallback.data.count} chapters) ›
                </Text>
              </Pressable>
            )}


            {cleanDescription(m.description) ? (
              <View><Text numberOfLines={descriptionOpen ? undefined : 3} style={styles.description}>{cleanDescription(m.description)}</Text><Pressable onPress={() => setDescriptionOpen(v => !v)} style={styles.descriptionToggle}><Text style={styles.descriptionToggleText}>{descriptionOpen ? 'Less' : 'More'}</Text></Pressable></View>
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
                <View style={styles.chapterHeadingRow}><Text style={styles.chaptersHeading}>Chapters <Text style={styles.chapterCount}>{chapterList?.length ?? ''}</Text></Text><Pressable onPress={() => setLanguageOpen(true)} style={styles.languageChip}><Text style={styles.orderText}>{lang.toUpperCase()}</Text><Ionicons name="chevron-down" size={13} color={colors.textMuted} /></Pressable></View>
                {showingOffline && (
                  <View style={styles.offlineNote}>
                    <Ionicons name="cloud-offline-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.offlineNoteText}>
                      Offline — showing your downloaded chapters.
                    </Text>
                    <Pressable onPress={() => chapters.refetch()} hitSlop={10}>
                      <Text style={styles.offlineRetry}>Retry</Text>
                    </Pressable>
                  </View>
                )}
                {chaptersFailed && !showingOffline && !offlineChapters.isLoading && (
                  <View style={styles.offlineNote}>
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <Text style={styles.offlineNoteText}>
                      Couldn’t load chapters from {source?.name ?? sourceId}.
                    </Text>
                    <Pressable onPress={() => chapters.refetch()} hitSlop={10}>
                      <Text style={styles.offlineRetry}>Retry</Text>
                    </Pressable>
                  </View>
                )}
                {chapterList && chapterList.length > 0 && (
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
                      <Text style={styles.orderText}>{newestFirst ? 'Newest' : 'Oldest'}</Text>
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
                    {m.contentRating?.includes('18')
                      ? `This is an 18+ title — ${source?.name ?? 'this source'} only shows its chapters to logged-in users on their website. If it's available on another source, a "Read on" option will appear above.`
                      : `No readable chapters here. ${source?.name ?? 'This source'} may have licensed this title (chapters link out). Try another source from the Sources tab — popular titles often read on Mangapill, MangaLib or Remanga.`}
                  </Text>
                )}
                {chapterList && chapterList.length > 0 && displayedChapters.length === 0 && (
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
              style={({ pressed }) => [styles.chapterRow, isCurrent && styles.currentRow, pressed && styles.chapterRowPressed]}
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
                {isCurrent && <View style={styles.currentProgress}><View style={[styles.currentProgressFill, { width: (progressPercent + '%') as `${number}%` }]} /></View>}
                {(item.title || item.publishedAt) && <Text style={styles.chapterMeta} numberOfLines={1}>{[item.title, item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null].filter(Boolean).join(' · ')}</Text>}
                {item.scanlationGroup ? (
                  <Text style={styles.chapterMeta}>{item.scanlationGroup}</Text>
                ) : null}
              </View>

              {(() => {
                const key = downloadKey(sourceId, item.externalId);
                const active = dlActive[key];
                const isDownloaded = dlSet.has(item.externalId);
                return (
                  <Pressable
                    // Slop never reaches into the read toggle next to it — an
                    // overlap there turned taps on ⬇ into "mark read".
                    accessibilityLabel={dlSet.has(item.externalId) ? 'Remove chapter download' : 'Download chapter'}
                    style={styles.readToggle}
                    onPress={() => {
                      if (active) return;
                      if (isDownloaded) {
                        Alert.alert('Delete download?', 'This chapter will be removed from the device.', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () =>
                              deleteDownload.chapter.mutate(
                                { sourceId, chapterId: item.externalId },
                                {
                                  onError: () =>
                                    Alert.alert(
                                      'Couldn’t delete',
                                      'The chapter’s files couldn’t be removed. Try again.',
                                    ),
                                },
                              ),
                          },
                        ]);
                      } else {
                        hapticTap();
                        downloadChapter.mutate({
                          chapterId: item.externalId,
                          chapterNumber: item.chapterNumber,
                        });
                      }
                    }}
                  >
                    {active ? (
                      <Text style={styles.dlProgress}>
                        {active.total ? `${active.done}/${active.total}` : '…'}
                      </Text>
                    ) : (
                      <Ionicons
                        name={isDownloaded ? 'arrow-down-circle' : 'download-outline'}
                        size={22}
                        color={isDownloaded ? colors.accent : colors.textFaint}
                      />
                    )}
                  </Pressable>
                );
              })()}
              <Pressable
                accessibilityLabel={isRead ? 'Mark chapter unread' : 'Mark chapter read'}
                style={styles.readToggle}
                onPress={() =>
                  {
                    hapticTap();
                    markRead.mutate({
                      items: [{ chapterId: item.externalId, chapterNumber: item.chapterNumber }],
                      read: !isRead,
                    });
                  }
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
        ListFooterComponent={
          similar.data && similar.data.length > 0 ? (
            <View style={styles.similarSection}>
              <Text style={styles.similarHeading}>More like this</Text>
              <FlatList
                horizontal
                data={similar.data}
                keyExtractor={(s) => `${s.sourceId}:${s.externalId}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
                renderItem={({ item: s }) => (
                  <MangaCard
                    width={112}
                    title={s.title}
                    coverUrl={s.coverUrl}
                    onPress={() =>
                      router.push({
                        pathname: '/manga/[id]',
                        params: { id: s.externalId, sourceId: s.sourceId },
                      })
                    }
                  />
                )}
              />
            </View>
          ) : null
        }
      />

      <BottomSheet visible={sourceOpen} title="Read on" onClose={() => setSourceOpen(false)}>
        {displayVariants.map(v => <Pressable key={v.sourceId + ':' + v.externalId} style={styles.statusRow} onPress={() => { switchSource(v); setSourceOpen(false); }}><View style={styles.availSourceRow}><View style={[styles.availDot, { backgroundColor: sourceMeta(v.sourceId).color }]} /><Text style={styles.statusRowText}>{sourceMeta(v.sourceId).name}</Text></View>{v.sourceId === sourceId && v.externalId === id && <Ionicons name="checkmark" size={20} color={colors.accent} />}</Pressable>)}
        <Pressable style={styles.statusRow} onPress={() => { setSourceOpen(false); setLanguageOpen(true); }}><Text style={styles.statusRowText}>Language · {languageLabel(lang)}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>
      </BottomSheet>
      <BottomSheet visible={languageOpen} title="Chapter language" onClose={() => setLanguageOpen(false)}>
        {(sourceLangs.length ? sourceLangs : [lang]).map(code => <Pressable key={code} style={styles.statusRow} onPress={() => { pickLang(code); setLanguageOpen(false); }}><Text style={styles.statusRowText}>{languageLabel(code)}</Text>{code === lang && <Ionicons name="checkmark" size={20} color={colors.accent} />}</Pressable>)}
      </BottomSheet>
      <BottomSheet visible={statusOpen} title="Library status" onClose={() => setStatusOpen(false)}>
        <Pressable style={styles.statusRow} onPress={() => { const next = !libStatus.data?.favorite; if (next) hapticSuccess(); else hapticTap(); toggleFavorite.mutate(next); }}><Text style={styles.statusRowText}>Favourite</Text><Ionicons name={libStatus.data?.favorite ? 'heart' : 'heart-outline'} size={22} color={colors.accent} /></Pressable>
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

  titleOverview: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 16 },
  titleInfo: { flex: 1, minWidth: 0, gap: 8 },
  alsoOn: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  alsoOnButton: { minHeight: 36, justifyContent: 'center' },
  descriptionToggle: { alignSelf: 'flex-start', paddingHorizontal: 16, minHeight: 32, justifyContent: 'center' },
  descriptionToggleText: { ...typography.bodyStrong, color: colors.accent },
  chapterHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 20, marginBottom: 12 },
  chapterCount: { ...typography.caption, color: colors.textMuted },
  languageChip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated, paddingHorizontal: 12 },
  currentRow: { backgroundColor: 'rgba(255,122,48,0.06)' },
  currentProgress: { height: 3, borderRadius: 3, backgroundColor: colors.border, marginTop: 8, maxWidth: 160, overflow: 'hidden' },
  currentProgressFill: { height: '100%', backgroundColor: colors.accent },
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
    width: '34%',
    aspectRatio: 0.69,
    maxWidth: 148,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    fontSize: 25,
    textAlign: 'left',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'left',
    marginTop: 0,
    textTransform: 'capitalize',
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  genrePillText: { ...typography.caption, color: colors.textMuted },
  dlProgress: { ...typography.tiny, color: colors.accent, fontWeight: '700', minWidth: 34, textAlign: 'center' },
  similarSection: { marginTop: spacing.xl, gap: spacing.md },
  similarHeading: {
    ...typography.h3,
    color: colors.text,
    paddingHorizontal: spacing.lg,
  },
  metaChip: {
    minHeight: 40,
    alignSelf: 'flex-start', maxWidth: '100%',
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
  metaChipText: { ...typography.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },

  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 0, alignItems: 'stretch' },
  primaryBtn: {
    flex: 1,
    minHeight: 52, paddingHorizontal: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { backgroundColor: colors.card },
  primaryBtnText: { ...typography.caption, fontWeight: '700', flexShrink: 1, color: '#1A0E06' },
  primaryBtnTextDisabled: { color: colors.textFaint },
  secondaryActions: { maxWidth: '38%' },
  secondaryBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
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
  secondaryBtnText: { ...typography.caption, color: colors.text, fontWeight: '600', flexShrink: 1 },
  availSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  availDot: { width: 7, height: 7, borderRadius: radius.pill },
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
  chaptersHeading: { ...typography.h3, color: colors.text, flex: 1 },
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
  offlineNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  offlineNoteText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  offlineRetry: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  retryBtnText: { ...typography.bodyStrong, color: '#1A0E06' },
  backLink: { ...typography.body, color: colors.textMuted },
  chapterTitle: { ...typography.bodyStrong, color: colors.text },
  chapterRead: { color: colors.textFaint },
  readToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chapterMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
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
