import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { imageSource } from '@/lib/imageSource';
import type { MangaSearchResult } from '@/data/sources/types';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

const W = Dimensions.get('window').width;
const HEIGHT = 360;
const INTERVAL = 4500;

type Props = {
  items: MangaSearchResult[];
  topInset: number;
  onOpen: (manga: MangaSearchResult) => void;
};

/** Auto-rotating, swipeable featured banner at the top of Home. */
export function HeroCarousel({ items, topInset, onOpen }: Props) {
  const listRef = useRef<FlatList<MangaSearchResult>>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);

  // Auto-advance; reads the live index from a ref to dodge stale closures.
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      const next = (indexRef.current + 1) % items.length;
      listRef.current?.scrollToOffset({ offset: next * W, animated: true });
      indexRef.current = next;
      setIndex(next);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [items.length]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / W);
    indexRef.current = i;
    setIndex(i);
  };

  return (
    <View>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(m) => m.externalId}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item)} style={styles.slide}>
            {item.coverUrl && (
              <Image
                source={imageSource(item.coverUrl)}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={250}
              />
            )}
            <LinearGradient
              colors={['rgba(14,11,26,0.05)', 'rgba(14,11,26,0.55)', colors.bg]}
              locations={[0, 0.6, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.content, { paddingTop: topInset + spacing.sm }]}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>★ Featured</Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={styles.cta}>
                <Text style={styles.ctaText}>Read now ›</Text>
              </View>
            </View>
          </Pressable>
        )}
      />

      <View style={styles.dots}>
        {items.map((m, i) => (
          <View key={m.externalId} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    width: W,
    height: HEIGHT,
    justifyContent: 'flex-end',
    backgroundColor: colors.card,
  },
  content: { padding: spacing.lg, gap: spacing.sm },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  tagText: { ...typography.tiny, color: '#1A0E06', fontWeight: '800' },
  title: { ...typography.h1, color: '#fff', maxWidth: '92%' },
  cta: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  ctaText: { ...typography.bodyStrong, color: '#1A0E06' },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  dotActive: { backgroundColor: colors.accent, width: 18 },
});
