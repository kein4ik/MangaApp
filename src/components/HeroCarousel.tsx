import { useEffect, useRef, useState } from 'react';
import { AppState, FlatList, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { MangaSearchResult } from '@/data/sources/types';
import { colors, spacing } from '@/theme/colors';
import { FeaturedManga } from './FeaturedManga';

export function HeroCarousel({ items, onOpen, paused = false }: {
  items: MangaSearchResult[]; onOpen: (manga: MangaSearchResult) => void; paused?: boolean;
}) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<MangaSearchResult>>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  const signature = items.map(m => m.sourceId + ':' + m.externalId).join('|');
  useEffect(() => {
    indexRef.current = 0; setIndex(0);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [signature, width]);
  useEffect(() => {
    if (paused || !active || items.length < 2) return;
    const timer = setInterval(() => {
      const next = (indexRef.current + 1) % items.length;
      list.current?.scrollToOffset({ offset: next * width, animated: true });
      indexRef.current = next; setIndex(next);
    }, 4500);
    return () => clearInterval(timer);
  }, [paused, active, items.length, width]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    indexRef.current = next; setIndex(next);
  };
  return <View>
    <FlatList ref={list} data={items} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      keyExtractor={m => m.sourceId + ':' + m.externalId} onMomentumScrollEnd={onScroll}
      getItemLayout={(_, itemIndex) => ({ length: width, offset: itemIndex * width, index: itemIndex })}
      removeClippedSubviews={false}
      initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
      renderItem={({ item }) => <View style={{ width, paddingHorizontal: spacing.lg }}>
        <FeaturedManga manga={item} onPress={() => onOpen(item)} />
      </View>} />
    <View style={styles.dots}>{items.map((m, i) => <View key={m.sourceId + ':' + m.externalId} style={[styles.dot, i === index && styles.active]} />)}</View>
  </View>;
}
const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: colors.border },
  active: { width: 20, backgroundColor: colors.accent },
});
