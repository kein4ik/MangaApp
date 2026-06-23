import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
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

import { useQueryClient } from '@tanstack/react-query';

import { useChapterPages, useChapters } from '@/data/queries';
import { SourceManager } from '@/data/sources/registry';
import { saveProgress } from '@/data/local/db';
import { useReaderSettings } from '@/store/reader.store';
import { useSettings } from '@/store/settings.store';
import type { Chapter, ChapterPage } from '@/data/sources/types';
import { colors, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

/** One full-screen page for horizontal paged mode (whole page fits the screen). */
function PagedImage({ page }: { page: ChapterPage }) {
  return (
    <View style={styles.pagedSlide}>
      <Image
        source={{ uri: page.imageUrl, headers: page.headers }}
        style={{ width: SCREEN_W, height: SCREEN_H }}
        contentFit="contain"
        allowDownscaling={false}
        cachePolicy="memory-disk"
        transition={100}
        recyclingKey={page.imageUrl}
      />
    </View>
  );
}

/**
 * One page. Holds its own aspect ratio so the list can lay out before the
 * image is measured, then snaps to the real ratio on load. expo-image handles
 * lazy decode + memory/disk caching, so we don't hold all pages in memory.
 */
function PageImage({ page, gap }: { page: ChapterPage; gap: number }) {
  // Use the page's known dimensions if the source provides them (MangaLib does)
  // so the row is sized correctly up front — no layout jump when the image loads.
  const known = page.width && page.height ? page.width / page.height : undefined;
  const [ratio, setRatio] = useState(known ?? 0.7);

  // FlashList recycles this component; reset the ratio for the new page so a
  // recycled row doesn't briefly render at the previous page's aspect ratio.
  useEffect(() => {
    setRatio(known ?? 0.7);
  }, [page.imageUrl, known]);

  return (
    <View style={{ width: SCREEN_W, marginBottom: gap }}>
      <Image
        source={{ uri: page.imageUrl, headers: page.headers }}
        style={{ width: SCREEN_W, aspectRatio: ratio }}
        contentFit="contain"
        // Don't downscale — it visibly blurs manga pages. Smoothness comes from
        // a small drawDistance + known dimensions (no relayout), not downscaling.
        allowDownscaling={false}
        cachePolicy="memory-disk"
        transition={100}
        recyclingKey={page.imageUrl}
        onLoad={(e) => {
          if (!known) {
            const { width, height } = e.source;
            if (width && height) setRatio(width / height);
          }
        }}
      />
    </View>
  );
}

export default function ReaderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    chapterId: string;
    sourceId: string;
    mangaId: string;
    chapterNumber?: string;
    lang?: string;
    startPage?: string;
  }>();
  const { chapterId, sourceId, mangaId, chapterNumber } = params;

  const { mode, direction, pageGap, brightness, keepAwake } = useReaderSettings();
  // Keep the screen on while reading. Use the imperative API in an effect — a
  // conditional `useKeepAwake()` hook would break the Rules of Hooks when the
  // toggle changes (the hook count would differ between renders).
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, [keepAwake]);

  const { language: settingsLanguage } = useSettings();
  // Lock the reading language to whatever the chapter was opened with, so prev/
  // next never mixes languages mid-session (MangaDex has separate chapter ids
  // per language). Falls back to the current setting only if not passed.
  const lang = params.lang || settingsLanguage;

  const { data: pages, isLoading, isError, refetch } = useChapterPages(sourceId, chapterId);

  // Full chapter list (in the locked language) for prev/next navigation.
  const { data: chapters } = useChapters(sourceId, mangaId, lang);
  const idx = chapters?.findIndex((c) => c.externalId === chapterId) ?? -1;
  const prevChapter = idx > 0 ? chapters?.[idx - 1] : undefined;
  const nextChapter =
    idx >= 0 && chapters && idx < chapters.length - 1 ? chapters[idx + 1] : undefined;

  // Prefetch the NEXT chapter's page list so tapping "next" opens instantly.
  const qc = useQueryClient();
  useEffect(() => {
    if (!nextChapter) return;
    qc.prefetchQuery({
      queryKey: ['pages', sourceId, nextChapter.externalId],
      queryFn: () => SourceManager.require(sourceId).getChapterPages(nextChapter.externalId),
      staleTime: 8 * 60 * 1000,
    }).catch(() => {});
  }, [qc, sourceId, nextChapter?.externalId]);

  const [currentPage, setCurrentPage] = useState(Number(params.startPage ?? 0));
  const [chromeVisible, setChromeVisible] = useState(true);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = pages?.length ?? 0;

  // Reset scroll position tracking when we switch chapters (same screen reused).
  useEffect(() => {
    setCurrentPage(Number(params.startPage ?? 0));
  }, [chapterId, params.startPage]);

  const goToChapter = useCallback(
    (ch: Chapter) => {
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
    [router, sourceId, mangaId, lang],
  );

  // Debounced progress save: every page change, but at most ~once/sec.
  useEffect(() => {
    if (total === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProgress({
        sourceId,
        mangaExternalId: mangaId,
        chapterId,
        chapterNumber,
        language: lang,
        pageIndex: currentPage,
        percent: total > 0 ? (currentPage + 1) / total : 0,
      }).catch(() => {});
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [currentPage, total, sourceId, mangaId, chapterId, chapterNumber, lang]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.index;
      if (typeof first === 'number') setCurrentPage(first);
    },
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderItem = useCallback(
    ({ item }: { item: ChapterPage }) => <PageImage page={item} gap={pageGap} />,
    [pageGap],
  );

  // Paged mode. RTL is done by reversing the data (not `inverted`, which would
  // mirror the page images) and mapping visual index <-> logical page index.
  const rtl = mode === 'paged' && direction === 'rtl';
  const pagedData = rtl ? [...(pages ?? [])].reverse() : pages ?? [];
  const toVisual = (p: number) => (rtl ? total - 1 - p : p);

  const onPagedScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const visual = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setCurrentPage(rtl ? total - 1 - visual : visual);
  };

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

  const resetZoom = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    sx.value = 0;
    sy.value = 0;
  };

  // Reset zoom when the chapter changes (same screen is reused).
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    sx.value = 0;
    sy.value = 0;
    setZoomed(false);
  }, [chapterId, scale, savedScale, tx, ty, sx, sy]);

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
    .onEnd(() => setChromeVisible((v) => !v));

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));

  if (isLoading) {
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

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.zoomLayer, zoomStyle]}>
        {mode === 'paged' ? (
          <FlatList
            key={`paged-${chapterId}-${direction}`}
            data={pagedData}
            keyExtractor={(item) => String(item.index)}
            renderItem={({ item }) => <PagedImage page={item} />}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={toVisual(currentPage)}
            getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
            onMomentumScrollEnd={onPagedScrollEnd}
            onScrollBeginDrag={() => setChromeVisible(false)}
            windowSize={3}
          />
        ) : (
          <FlashList
            // Remount on chapter change so scroll resets to the top.
            key={chapterId}
            data={pages}
            keyExtractor={(item) => String(item.index)}
            renderItem={renderItem}
            initialScrollIndex={currentPage}
            scrollEnabled={!zoomed}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            showsVerticalScrollIndicator={false}
            // Hide the toolbars as soon as the user starts scrolling to read.
            onScrollBeginDrag={() => setChromeVisible(false)}
            // Render ~1.5 screens ahead — enough to feel seamless without
            // decoding a pile of tall pages and stuttering.
            drawDistance={SCREEN_W * 1.5}
            ListFooterComponent={
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
            }
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
            <Text style={styles.topBarPage}>
              {currentPage + 1} / {total}
            </Text>
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
            <Text style={[styles.navText, !prevChapter && styles.navTextDisabled]}>
              ‹ Prev
            </Text>
          </Pressable>
          <Text style={styles.navCenter}>
            {chapterNumber ? `Chapter ${chapterNumber}` : 'Reader'}
          </Text>
          <Pressable
            style={[styles.navBtn, !nextChapter && styles.navBtnDisabled]}
            disabled={!nextChapter}
            onPress={() => nextChapter && goToChapter(nextChapter)}
          >
            <Text style={[styles.navText, !nextChapter && styles.navTextDisabled]}>
              Next ›
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.progressTrack} pointerEvents="none">
        <View
          style={[styles.progressFill, { width: `${((currentPage + 1) / total) * 100}%` }]}
        />
      </View>

      <BottomSheet
        visible={chapterPickerOpen}
        title="Chapters"
        onClose={() => setChapterPickerOpen(false)}
      >
        <ScrollView style={{ maxHeight: 420 }}>
          {(chapters ?? []).map((ch) => {
            const active = ch.externalId === chapterId;
            return (
              <Pressable
                key={ch.externalId}
                style={[styles.pickRow, active && styles.pickRowActive]}
                onPress={() => {
                  setChapterPickerOpen(false);
                  if (!active) goToChapter(ch);
                }}
              >
                <Text style={[styles.pickText, active && { color: colors.accent }]}>
                  {ch.chapterNumber ? `Chapter ${ch.chapterNumber}` : ch.title || 'Oneshot'}
                </Text>
                {active && <Text style={styles.pickCurrent}>reading</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>

      <ReaderSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  zoomLayer: { flex: 1 },
  pagedSlide: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  pickRowActive: { backgroundColor: colors.card },
  pickText: { ...typography.body, color: colors.text },
  pickCurrent: { ...typography.tiny, color: colors.accent, textTransform: 'uppercase' },
});
