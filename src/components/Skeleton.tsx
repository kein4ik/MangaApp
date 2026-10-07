import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme/colors';

/**
 * Loading placeholders that mirror the shape of the content being fetched.
 * They read as "the screen is already here, filling in" instead of a spinner
 * on an empty page — the app feels considerably faster at the same speed.
 * The pulse runs on the UI thread (Reanimated), so it stays smooth even while
 * the JS thread is busy parsing source responses.
 */

function usePulse() {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/** One shimmering block. */
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const pulse = usePulse();
  return <Animated.View style={[styles.block, style, pulse]} />;
}

/** Cover + title lines, matching MangaCard's proportions. */
export function CardSkeleton({ width }: { width: number }) {
  return (
    <View style={{ width }}>
      <Skeleton style={{ width, height: width * 1.45, borderRadius: radius.md }} />
      <Skeleton style={{ width: width * 0.9, height: 11, marginTop: 8, borderRadius: 4 }} />
      <Skeleton style={{ width: width * 0.55, height: 9, marginTop: 6, borderRadius: 4 }} />
    </View>
  );
}

/** A horizontal rail of cards (Home). */
export function RailSkeleton({ width, count = 4 }: { width: number; count?: number }) {
  return (
    <View style={styles.rail}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} width={width} />
      ))}
    </View>
  );
}

/** A grid of cards (search results, genre browse, top). */
export function GridSkeleton({
  width,
  columns = 3,
  rows = 3,
}: {
  width: number;
  columns?: number;
  rows?: number;
}) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: columns * rows }, (_, i) => (
        <CardSkeleton key={i} width={width} />
      ))}
    </View>
  );
}

/** Cover + text lines, matching the list rows in Library and Updates. */
export function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton style={{ width: 56, height: 78, borderRadius: radius.sm }} />
          <View style={styles.rowLines}>
            <Skeleton style={{ width: '70%', height: 12, borderRadius: 4 }} />
            <Skeleton style={{ width: '40%', height: 10, borderRadius: 4 }} />
            <Skeleton style={{ width: '55%', height: 10, borderRadius: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.card },
  rail: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowLines: { flex: 1, gap: 8 },
});
