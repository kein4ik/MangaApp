import { FlashList, useRecyclingState, type ViewToken } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { Image, type ImageLoadEventData } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  FlatList,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { ReaderSettingsSheet } from '@/components/ReaderSettingsSheet';
import { useAsuraReaderPages } from '@/components/useAsuraReaderPages';
import { saveProgress } from '@/data/local/db';
import {
  fetchChapterPages,
  useChapterPages,
  useChapters,
  useOfflineChapters,
} from '@/data/queries';
import type { Chapter, ChapterPage } from '@/data/sources/types';
import { chapterNeighbours } from '@/lib/chapters';
import { hapticTap } from '@/lib/haptics';
import { asuraDecodeSize } from '@/lib/readerImagePolicy';
import { knownPageSize as knownSize, rememberPageSize as rememberSize, type PageSize } from '@/lib/readerPageSizes';
import { useGuardedRouter } from '@/lib/useGuardedRouter';
import { useReaderSettings } from '@/store/reader.store';
import { useSettings } from '@/store/settings.store';
import { colors, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const PAGES_STALE_MS = 8 * 60 * 1000;
/** Legacy prefetch for other sources; Asura on Android only prepares metadata. */
const PREFETCH_AHEAD = 4;
const isRemote = (url: string) => /^https?:\/\//i.test(url);

// ---- Page sizes ----
// A page has to be laid out at its real height from the first frame: every
// later correction re-lays the list (visible jank). Sizes come from the source
// when it publishes them; otherwise the first full-size decode is remembered
// here, so a recycled or re-opened page never guesses twice.
const DEFAULT_RATIO = 0.7;
// Pages of one chapter nearly always share a shape, so the last measured page
// is a far better first guess for an unknown one than a fixed constant.
let lastMeasuredRatio = DEFAULT_RATIO;

// ---- Decoding ----
// A page sits in memory at 4 bytes per pixel whatever its file size: a
// 1500×2200 scan takes 13 MB, a 3000×4300 one 52 MB, and the reader keeps a few
// pages ready. Pages up to 1.5× the screen's width decode in full, so zooming
// stays sharp; wider ones decode at screen size — the same picture unzoomed, for
// a fraction of the memory and decode time. On Android both paths also keep any
// single bitmap under the size the system refuses to draw (a crash otherwise).
// iOS decodes in full before resizing anyway, so it keeps full size.
const SCREEN_PX_W = SCREEN_W * PixelRatio.get();
const isOversized = (size: PageSize | undefined) => !!size && size.w > SCREEN_PX_W * 1.5;

function decodeProps(size: PageSize | undefined) {
  if (Platform.OS !== 'android') return { contentFit: 'fill', allowDownscaling: false } as const;
  // "contain" decodes at the view's size; "fill" in full (capped at the limit).
  return isOversized(size)
    ? ({ contentFit: 'contain', allowDownscaling: true } as const)
    : ({ contentFit: 'fill', allowDownscaling: true } as const);
}

/** The page's own shape, as large as fits the screen (paged mode). */
function fitToScreen(size: PageSize) {
  const ratio = size.w / size.h;
  return ratio > SCREEN_W / SCREEN_H
    ? { width: SCREEN_W, height: SCREEN_W / ratio }
    : { width: SCREEN_H * ratio, height: SCREEN_H };
}

// ---- Current page, outside React state ----
// Page changes happen constantly while scrolling. Keeping them out of the
// screen's state means only the tiny counter/progress widgets re-render —
// not the list, the gestures and every toolbar.
function createPageStore(start: number) {
  let page = start;
  let furthest = start;
  const listeners = new Set<() => void>();
  return {
    page: () => page,
    /** Deepest page seen this session — what "% read" is based on. */
    furthest: () => furthest,
    set(next: number, seenUpTo = next) {
      const nextFurthest = Math.max(furthest, seenUpTo);
      if (next === page && nextFurthest === furthest) return;
      page = next;
      furthest = nextFurthest;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type PageStore = ReturnType<typeof createPageStore>;

function PageCounter({ store, total }: { store: PageStore; total: number }) {
  const page = useSyncExternalStore(store.subscribe, store.page);
  return (
    <Text style={styles.topBarPage}>
      {page + 1} / {total}
    </Text>
  );
}

function ProgressLine({ store, total }: { store: PageStore; total: number }) {
  const page = useSyncExternalStore(store.subscribe, store.page);
  return (
    <View style={styles.progressTrack} pointerEvents="none">
      <View style={[styles.progressFill, { width: `${((page + 1) / total) * 100}%` }]} />
    </View>
  );
}

/**
 * Debounced progress saving that never loses the last position: pending saves
 * are written immediately when the reader closes, switches chapter, or the app
 * goes to the background (they used to be dropped with the timer).
 */
function useProgressSaver(
  store: PageStore,
  meta: {
    sourceId: string;
    mangaId: string;
    chapterId: string;
    chapterNumber?: string;
    lang: string;
    total: number;
  },
  /** After the save that happens on leaving: refresh screens showing progress. */
  onLeft: () => void,
) {
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const flush = useCallback(
    (leaving = false) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const m = metaRef.current;
      if (!dirty.current || m.total === 0) return;
      dirty.current = false;
      saveProgress({
        sourceId: m.sourceId,
        mangaExternalId: m.mangaId,
        chapterId: m.chapterId,
        chapterNumber: m.chapterNumber,
        language: m.lang,
        pageIndex: store.page(),
        percent: Math.min(1, (store.furthest() + 1) / m.total),
      })
        // The title page underneath re-reads progress when it regains focus —
        // possibly before this last write lands. Refresh it once it has.
        .then(() => {
          if (leaving) onLeftRef.current();
        })
        .catch(() => {});
    },
    [store],
  );

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 800);
  }, [flush]);

  useEffect(() => store.subscribe(schedule), [store, schedule]);
  // Opening the chapter is progress too (it shows in Continue Reading at once).
  useEffect(() => {
    if (meta.total > 0) schedule();
  }, [meta.total, schedule]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush(true);
    };
  }, [flush]);

  return flush;
}

/** expo-image's Android prefetch also decodes pixels, even with the disk policy. */
function usePagePrefetch(store: PageStore, pages: ChapterPage[] | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !pages?.length) return;
    const requested = new Set<number>();
    const run = () => {
      const from = store.page() + 1;
      const batch = pages
        .slice(from, from + PREFETCH_AHEAD)
        .filter((p) => !requested.has(p.index) && isRemote(p.imageUrl));
      if (batch.length === 0) return;
      batch.forEach((p) => requested.add(p.index));
      Image.prefetch(
        batch.map((p) => p.imageUrl),
        { cachePolicy: 'disk', headers: batch[0].headers },
      ).catch(() => {});
    };
    run();
    return store.subscribe(run);
  }, [store, pages, enabled]);
}

// ---- Pages ----

type PageProps = {
  page: ChapterPage;
  gap: number;
  onRetry: () => void;
  waitingForSize: boolean;
  optimizeAsura: boolean;
};

/**
 * Expo Image 56's Android SourceMap passes source width/height to Glide's
 * override(). With "contain", those bound the decode independently of the
 * tall on-screen view. Keep layout/progress based on the ORIGINAL page size.
 */
function pageImageRequest(page: ChapterPage, size: PageSize | undefined, optimizeAsura: boolean) {
  const bounded = optimizeAsura ? asuraDecodeSize(size) : undefined;
  return {
    source: {
      uri: page.imageUrl,
      headers: page.headers,
      ...(bounded ? { width: bounded.w, height: bounded.h } : {}),
    },
    ...(bounded ? { contentFit: 'contain' as const, allowDownscaling: true } : decodeProps(size)),
    // Disk caching retains the downloaded file, without retaining old decoded
    // strips in Glide's memory cache after their cells leave the render window.
    cachePolicy: optimizeAsura ? 'disk' as const : 'memory-disk' as const,
    transition: optimizeAsura ? 0 : 100,
  };
}

/**
 * One vertical-mode page. FlashList recycles these cells, so per-page state uses
 * useRecyclingState: it resets in the same render the cell gets a new page (no
 * frame at the previous page's size), and a size change re-lays the list.
 */
const PageImage = memo(function PageImage({ page, gap, onRetry, waitingForSize, optimizeAsura }: PageProps) {
  const known = knownSize(page);
  const [ratio, setRatio] = useRecyclingState(
    () => (known ? known.w / known.h : lastMeasuredRatio),
    [page.imageUrl, page.width, page.height],
  );
  // The real size: up front from the source, or from the first (full-size)
  // decode. Until then the box only has a guessed shape, so the image stays
  // hidden rather than drawn stretched.
  const [size, setSize] = useRecyclingState(() => known, [page.imageUrl, page.width, page.height]);
  const [failed, setFailed] = useRecyclingState(false, [page.imageUrl]);
  const [attempt, setAttempt] = useRecyclingState(0, [page.imageUrl]);
  const request = pageImageRequest(page, size, optimizeAsura);

  const onLoad = useCallback(
    (e: ImageLoadEventData) => {
      const { width, height } = e.source;
      if (!width || !height) return;
      const real = width / height;
      lastMeasuredRatio = real;
      // Snap to the real shape (sources sometimes round the size they publish).
      setRatio((r) => (Math.abs(real - r) / real > 0.01 ? real : r));
      // Only the first decode is full-size; a screen-size one reports its own size.
      if (!size) {
        const measured = { w: width, h: height };
        rememberSize(page.imageUrl, measured);
        setSize(measured);
      }
    },
    [page.imageUrl, size, setRatio, setSize],
  );

  // The error card has the page's own size, so these don't need a list re-layout.
  const retry = useCallback(() => {
    setFailed(false, true);
    setAttempt((a) => a + 1, true);
    onRetry();
  }, [onRetry, setFailed, setAttempt]);

  return (
    <View style={{ width: SCREEN_W, aspectRatio: ratio, marginBottom: gap }}>
      {waitingForSize ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : failed ? (
        // On a page taller than the screen a centred message would sit far
        // out of view — show it near the top, where scrolling arrives.
        <Pressable
          style={[styles.pageError, ratio < SCREEN_W / SCREEN_H && styles.pageErrorTall]}
          onPress={retry}
        >
          <Text style={styles.pageErrorTitle}>Page {page.index + 1} didn’t load</Text>
          <Text style={styles.pageErrorHint}>Tap to retry</Text>
        </Pressable>
      ) : (
        <Image
          key={attempt}
          {...request}
          style={[StyleSheet.absoluteFill, !size && styles.unmeasured]}
          recyclingKey={page.imageUrl}
          onLoad={onLoad}
          onError={() => setFailed(true, true)}
        />
      )}
    </View>
  );
});

/** One full-screen page for horizontal paged mode (whole page fits the screen). */
const PagedImage = memo(function PagedImage({
  page,
  onRetry,
  waitingForSize,
  optimizeAsura,
}: {
  page: ChapterPage;
  onRetry: () => void;
  waitingForSize: boolean;
  optimizeAsura: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The image view takes the page's own shape (not the whole screen), so the
  // same decode rules as vertical mode apply; hidden until that shape is known.
  const [measuredSize, setSize] = useState(() => knownSize(page));
  const size = knownSize(page) ?? measuredSize;
  const request = pageImageRequest(page, size, optimizeAsura);
  const onLoad = useCallback(
    (e: ImageLoadEventData) => {
      const { width, height } = e.source;
      if (!width || !height || size) return;
      const measured = { w: width, h: height };
      rememberSize(page.imageUrl, measured);
      setSize(measured);
    },
    [page.imageUrl, size],
  );
  return (
    <View style={styles.pagedSlide}>
      {waitingForSize ? (
        <ActivityIndicator color={colors.accent} />
      ) : failed ? (
        <Pressable
          style={styles.pageError}
          onPress={() => {
            setFailed(false);
            setAttempt((a) => a + 1);
            onRetry();
          }}
        >
          <Text style={styles.pageErrorTitle}>Page {page.index + 1} didn’t load</Text>
          <Text style={styles.pageErrorHint}>Tap to retry</Text>
        </Pressable>
      ) : (
        <Image
          key={attempt}
          {...request}
          style={size ? fitToScreen(size) : [styles.pagedFull, styles.unmeasured]}
          recyclingKey={page.imageUrl}
          onLoad={onLoad}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
});

// ---- Chapter picker ----

const PICK_ROW_H = 48;

/** Virtualized and mounted only while open (was: every chapter rebuilt on every page turn). */
const ChapterPicker = memo(function ChapterPicker({
  chapters,
  currentId,
  onPick,
}: {
  chapters: Chapter[];
  currentId: string;
  onPick: (c: Chapter) => void;
}) {
  const index = chapters.findIndex((c) => c.externalId === currentId);
  if (chapters.length === 0) return <Text style={styles.pickEmpty}>No chapters</Text>;
  return (
    <FlatList
      style={{ maxHeight: 420 }}
      data={chapters}
      keyExtractor={(c) => c.externalId}
      getItemLayout={(_, i) => ({ length: PICK_ROW_H, offset: PICK_ROW_H * i, index: i })}
      initialScrollIndex={Math.max(0, index - 3)}
      initialNumToRender={16}
      windowSize={5}
      renderItem={({ item }) => {
        const active = item.externalId === currentId;
        return (
          <Pressable
            style={[styles.pickRow, active && styles.pickRowActive]}
            onPress={() => onPick(item)}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickText, active && { color: colors.accent }]} numberOfLines={1}>
                {item.chapterNumber ? `Chapter ${item.chapterNumber}` : item.title || 'Oneshot'}
              </Text>
              {item.scanlationGroup ? (
                <Text style={styles.pickGroup} numberOfLines={1}>
                  {item.scanlationGroup}
                </Text>
              ) : null}
            </View>
            {active && <Text style={styles.pickCurrent}>reading</Text>}
          </Pressable>
        );
      }}
    />
  );
});

// ---- Screen ----

type ReaderParams = {
  chapterId: string;
  sourceId: string;
  mangaId: string;
  chapterNumber?: string;
  lang?: string;
  startPage?: string;
};

export default function ReaderScreen() {
  const params = useLocalSearchParams<ReaderParams>();
  const { keepAwake } = useReaderSettings();
  const { language: settingsLanguage } = useSettings();

  // Keep the screen on while reading. Use the imperative API in an effect — a
  // conditional `useKeepAwake()` hook would break the Rules of Hooks when the
  // toggle changes (the hook count would differ between renders).
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync().catch(() => {});
    return () => {
      deactivateKeepAwake().catch(() => {});
    };
  }, [keepAwake]);

  // A fresh instance per chapter: its page store, zoom and pending save all
  // start clean, and the previous chapter's position is saved as it unmounts.
  return (
    <ReaderChapter
      key={params.chapterId}
      chapterId={params.chapterId}
      sourceId={params.sourceId}
      mangaId={params.mangaId}
      chapterNumber={params.chapterNumber}
      // Lock the reading language to whatever the chapter was opened with, so
      // prev/next never mixes languages mid-session (MangaDex has separate
      // chapter ids per language).
      lang={params.lang || settingsLanguage}
      startPage={Math.max(0, Number(params.startPage ?? 0) || 0)}
    />
  );
}

function ReaderChapter({
  chapterId,
  sourceId,
  mangaId,
  chapterNumber,
  lang,
  startPage,
}: {
  chapterId: string;
  sourceId: string;
  mangaId: string;
  chapterNumber?: string;
  lang: string;
  startPage: number;
}) {
  const router = useGuardedRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { mode, direction, pageGap, brightness } = useReaderSettings();

  const pagesQuery = useChapterPages(sourceId, chapterId);
  const { data: sourcePages, isLoading, isError, refetch } = pagesQuery;
  const [store] = useState(() => createPageStore(startPage));
  const prepareAsura = sourceId === 'asura' && Platform.OS === 'android';
  const { pages, pendingSizes, isPreparing } = useAsuraReaderPages(sourcePages, store, prepareAsura);
  const total = pages?.length ?? 0;

  // Chapter list (in the locked language) for prev/next — or, offline, the
  // downloaded chapters, so next/prev still work without network.
  const chaptersQuery = useChapters(sourceId, mangaId, lang);
  const offline = useOfflineChapters(
    sourceId,
    mangaId,
    chaptersQuery.isError && !chaptersQuery.data,
  );
  const chapters = chaptersQuery.data ?? offline.data;
  // Prev/next skip other groups' copies of this same chapter.
  const { prev: prevChapter, next: nextChapter } = useMemo(
    () => chapterNeighbours(chapters, chapterId),
    [chapters, chapterId],
  );

  const flushProgress = useProgressSaver(
    store,
    { sourceId, mangaId, chapterId, chapterNumber, lang, total },
    () => {
      qc.invalidateQueries({ queryKey: ['progress', sourceId, mangaId] });
      qc.invalidateQueries({ queryKey: ['read-chapters', sourceId, mangaId] });
      qc.invalidateQueries({ queryKey: ['read-numbers'] });
      qc.invalidateQueries({ queryKey: ['continue-reading'] });
    },
  );
  usePagePrefetch(store, pages, !prepareAsura);

  // Next chapter: its page list now (local-first, so a download is never
  // shadowed by network URLs), its first images once the end is near.
  useEffect(() => {
    if (!nextChapter) return;
    const id = nextChapter.externalId;
    qc.prefetchQuery({
      queryKey: ['pages', sourceId, id],
      queryFn: ({ signal }) => fetchChapterPages(sourceId, id, signal),
      staleTime: PAGES_STALE_MS,
    }).catch(() => {});
  }, [qc, sourceId, nextChapter?.externalId]);

  useEffect(() => {
    if (prepareAsura || !nextChapter || total === 0) return;
    let done = false;
    const check = () => {
      if (done || store.page() < total - 3) return;
      const next = qc.getQueryData<ChapterPage[]>(['pages', sourceId, nextChapter.externalId]);
      if (!next?.length) return;
      done = true;
      const first = next.slice(0, 3).filter((p) => isRemote(p.imageUrl));
      if (first.length) {
        Image.prefetch(
          first.map((p) => p.imageUrl),
          { cachePolicy: 'disk', headers: first[0].headers },
        ).catch(() => {});
      }
    };
    check();
    return store.subscribe(check);
  }, [qc, store, sourceId, nextChapter?.externalId, total, prepareAsura]);

  // A failed page gets a fresh list when its URLs may have expired (older than
  // 5 min), or when the chapter was saved while open — the list is then marked
  // invalidated (useDownloadChapter) and the refetch switches to the saved
  // files, which also work offline.
  const onRetryPage = useCallback(() => {
    const state = qc.getQueryState(['pages', sourceId, chapterId]);
    const old = Date.now() - (state?.dataUpdatedAt ?? 0) > 5 * 60 * 1000;
    if (old || state?.isInvalidated) refetch();
  }, [qc, sourceId, chapterId, refetch]);

  // Leaving with such a list: drop it, so the next open goes straight to the files.
  useEffect(
    () => () => {
      const key = ['pages', sourceId, chapterId];
      if (qc.getQueryState(key)?.isInvalidated) qc.removeQueries({ queryKey: key, exact: true });
    },
    [qc, sourceId, chapterId],
  );

  const [chromeVisible, setChromeVisible] = useState(true);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hideChrome = useCallback(() => setChromeVisible(false), []);
  const toggleChrome = useCallback(() => setChromeVisible((v) => !v), []);

  const goToChapter = useCallback(
    (ch: Chapter) => {
      flushProgress();
      hapticTap();
      router.replace({
        pathname: '/reader/[chapterId]',
        params: {
          chapterId: ch.externalId,
          sourceId,
          mangaId,
          chapterNumber: ch.chapterNumber ?? '',
          lang,
          startPage: '0',
        },
      });
    },
    [flushProgress, router, sourceId, mangaId, lang],
  );

  const pickChapter = useCallback(
    (ch: Chapter) => {
      setChapterPickerOpen(false);
      if (ch.externalId !== chapterId) goToChapter(ch);
    },
    [chapterId, goToChapter],
  );

  // ---- Vertical list plumbing (all stable, so page turns don't re-render it) ----
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChapterPage>[] }) => {
      let first = Infinity;
      let last = -1;
      for (const v of viewableItems) {
        if (typeof v.index !== 'number') continue;
        if (v.index < first) first = v.index;
        if (v.index > last) last = v.index;
      }
      if (last >= 0) store.set(first, last);
    },
    [store],
  );
  // Coverage of the SCREEN, not of the page: a page taller than two screens can
  // never be 50% visible, so a per-item threshold left the counter (and the
  // saved position) stuck on long strips. Fully visible pages always count.
  const viewabilityConfig = useMemo(() => ({ viewAreaCoveragePercentThreshold: 50 }), []);
  const renderItem = useCallback(
    ({ item }: { item: ChapterPage }) => (
      <PageImage page={item} gap={pageGap} onRetry={onRetryPage} waitingForSize={pendingSizes.has(item.index)} optimizeAsura={prepareAsura} />
    ),
    [pageGap, onRetryPage, pendingSizes, prepareAsura],
  );
  const footer = useMemo(
    () => (
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        {nextChapter ? (
          <Pressable style={styles.nextBtn} onPress={() => goToChapter(nextChapter)}>
            <Text style={styles.nextBtnText}>
              Next chapter{nextChapter.chapterNumber ? ` · ${nextChapter.chapterNumber}` : ''} →
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.footerEnd}>You’re on the latest chapter.</Text>
        )}
      </View>
    ),
    [insets.bottom, nextChapter, goToChapter],
  );

  // ---- Paged mode: RTL reverses the data (not `inverted`, which would mirror
  // the page images) and maps visual index <-> logical page index. ----
  const rtl = mode === 'paged' && direction === 'rtl';
  const pagedData = useMemo(() => (rtl ? [...(pages ?? [])].reverse() : pages ?? []), [pages, rtl]);
  const onPagedScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const visual = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
      store.set(rtl ? total - 1 - visual : visual);
    },
    [store, rtl, total],
  );
  const renderPaged = useCallback(
    ({ item }: { item: ChapterPage }) => (
      <PagedImage page={item} onRetry={onRetryPage} waitingForSize={pendingSizes.has(item.index)} optimizeAsura={prepareAsura} />
    ),
    [onRetryPage, pendingSizes, prepareAsura],
  );

  // ----- Zoom: pinch + double-tap, with pan when zoomed -----
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  useAnimatedReaction(
    () => scale.value > 1.01,
    (z, prev) => {
      if (z !== prev) runOnJS(setZoomed)(z);
    },
  );

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Built once per zoom state, not on every render.
  const gesture = useMemo(() => {
    const resetZoom = () => {
      'worklet';
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      sx.value = 0;
      sy.value = 0;
    };
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), 4);
      })
      .onEnd(() => {
        savedScale.value = scale.value;
        if (scale.value <= 1.01) resetZoom();
      });
    const pan = Gesture.Pan()
      .enabled(zoomed)
      .onUpdate((e) => {
        tx.value = sx.value + e.translationX;
        ty.value = sy.value + e.translationY;
      })
      .onEnd(() => {
        sx.value = tx.value;
        sy.value = ty.value;
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        if (scale.value > 1.01) resetZoom();
        else {
          scale.value = withTiming(2.5);
          savedScale.value = 2.5;
        }
      });
    // Single tap toggles toolbars; waits for double-tap to fail first.
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(220)
      .runOnJS(true)
      .onEnd(toggleChrome);
    return Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [zoomed, toggleChrome, scale, savedScale, tx, ty, sx, sy]);

  if (isLoading || isPreparing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Loading chapter…</Text>
      </View>
    );
  }

  if (isError || !pages || pages.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn’t load pages.</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // Where a (re)mounted list starts: the page being read right now — switching
  // vertical ⇄ paged mid-chapter keeps your place.
  const startIndex = Math.max(0, Math.min(store.page(), total - 1));

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.zoomLayer, zoomStyle]}>
          {mode === 'paged' ? (
            <FlatList
              key={`paged-${direction}`}
              data={pagedData}
              keyExtractor={pageKey}
              renderItem={renderPaged}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed}
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={rtl ? total - 1 - startIndex : startIndex}
              getItemLayout={pagedLayout}
              onMomentumScrollEnd={onPagedScrollEnd}
              onScrollBeginDrag={hideChrome}
              // Each item is a whole screen: open with the page and its
              // neighbour (FlatList's default renders 10 — ten full decodes
              // before the first page shows), then keep one either side.
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
            />
          ) : (
            <FlashList
              data={pages}
              keyExtractor={pageKey}
              renderItem={renderItem}
              initialScrollIndex={startIndex}
              scrollEnabled={!zoomed}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              showsVerticalScrollIndicator={false}
              // Hide the toolbars as soon as the user starts scrolling to read.
              onScrollBeginDrag={hideChrome}
              // About one screen ahead is laid out and decoded. Asura relies on
              // this window instead of separately decoding four remote strips.
              drawDistance={SCREEN_H}
              // Idle recycled cells otherwise keep their native image views
              // (and bitmaps) alive even beyond the actual render window.
              maxItemsInRecyclePool={prepareAsura ? 0 : undefined}
              ListFooterComponent={footer}
            />
          )}
        </Animated.View>
      </GestureDetector>

      {/* Brightness dim overlay over the pages (taps pass through). */}
      {brightness < 1 && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 1 - brightness }]}
        />
      )}

      {chromeVisible && (
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.topBarText}>‹ Back</Text>
          </Pressable>
          <Pressable onPress={() => setChapterPickerOpen(true)} hitSlop={12}>
            <Text style={styles.topBarText}>
              {chapterNumber ? `Chapter ${chapterNumber}` : 'Reader'} ▾
            </Text>
          </Pressable>
          <View style={styles.topRight}>
            <PageCounter store={store} total={total} />
            <Pressable onPress={() => setSettingsOpen(true)} hitSlop={12}>
              <Text style={styles.topBarText}>⚙</Text>
            </Pressable>
          </View>
        </View>
      )}

      {chromeVisible && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            style={[styles.navBtn, !prevChapter && styles.navBtnDisabled]}
            disabled={!prevChapter}
            onPress={() => prevChapter && goToChapter(prevChapter)}
          >
            <Text style={[styles.navText, !prevChapter && styles.navTextDisabled]}>‹ Prev</Text>
          </Pressable>
          <Text style={styles.navCenter}>
            {chapterNumber ? `Chapter ${chapterNumber}` : 'Reader'}
          </Text>
          <Pressable
            style={[styles.navBtn, !nextChapter && styles.navBtnDisabled]}
            disabled={!nextChapter}
            onPress={() => nextChapter && goToChapter(nextChapter)}
          >
            <Text style={[styles.navText, !nextChapter && styles.navTextDisabled]}>Next ›</Text>
          </Pressable>
        </View>
      )}

      <ProgressLine store={store} total={total} />

      <BottomSheet
        visible={chapterPickerOpen}
        title="Chapters"
        onClose={() => setChapterPickerOpen(false)}
      >
        {chapterPickerOpen ? (
          <ChapterPicker chapters={chapters ?? []} currentId={chapterId} onPick={pickChapter} />
        ) : null}
      </BottomSheet>

      <ReaderSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const pageKey = (item: ChapterPage) => String(item.index);
const pagedLayout = (_: unknown, i: number) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i });

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  zoomLayer: { flex: 1 },
  pagedSlide: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagedFull: { width: SCREEN_W, height: SCREEN_H },
  unmeasured: { opacity: 0 },
  pageError: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#111',
  },
  pageErrorTall: { justifyContent: 'flex-start', paddingTop: SCREEN_H * 0.3 },
  pageErrorTitle: { ...typography.bodyStrong, color: colors.text },
  pageErrorHint: { ...typography.caption, color: colors.accent },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: { ...typography.caption, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.danger },
  retryBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  retryText: { ...typography.bodyStrong, color: '#1A0E06' },
  backLink: { ...typography.body, color: colors.textMuted },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(14,11,26,0.92)',
  },
  topBarText: { ...typography.bodyStrong, color: colors.text },
  topBarPage: { ...typography.caption, color: colors.textMuted },

  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  progressFill: { height: 3, backgroundColor: colors.accent },

  footer: { paddingTop: spacing.xl, paddingHorizontal: spacing.lg, alignItems: 'center' },
  nextBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  nextBtnText: { ...typography.bodyStrong, color: '#1A0E06' },
  footerEnd: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.md },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: 'rgba(14,11,26,0.92)',
  },
  navBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.card,
  },
  navBtnDisabled: { opacity: 0.35 },
  navText: { ...typography.bodyStrong, color: colors.text },
  navTextDisabled: { color: colors.textFaint },
  navCenter: { ...typography.caption, color: colors.textMuted },

  pickRow: {
    height: PICK_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  pickRowActive: { backgroundColor: colors.card },
  pickText: { ...typography.body, color: colors.text },
  pickGroup: { ...typography.tiny, color: colors.textFaint },
  pickCurrent: { ...typography.tiny, color: colors.accent, textTransform: 'uppercase' },
  pickEmpty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.md },
});
