import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { CoverArt } from './CoverArt';
import { colors } from '@/theme/colors';
import { typography } from '@/theme/typography';
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type Props = { title: string; coverUrl?: string | null; subtitle?: string; progress?: number; sourceLabel?: string; sourceColor?: string; badge?: string; width: number; onPress: () => void };
export const MangaCard = memo(function MangaCard({ title, coverUrl, subtitle, progress = 0, sourceLabel, sourceColor, badge, width, onPress }: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    onPressIn={() => { scale.value = withSpring(0.97, { damping: 18, stiffness: 320 }); }}
    onPressOut={() => { scale.value = withSpring(1, { damping: 16, stiffness: 260 }); }}
    style={[{ width }, animatedStyle]}>
    <View><CoverArt uri={coverUrl} title={title} style={{ width, height: width * 1.45 }} />
      {!!badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
    </View>
    <Text numberOfLines={2} style={styles.title}>{title}</Text>
    {!!subtitle && <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>}
    {progress > 0 && <View style={styles.track}><View style={[styles.fill, { width: ((Math.min(1, progress) * 100) + '%') as `${number}%` }]} /></View>}
    {!!sourceLabel && <View style={styles.source}><View style={[styles.dot, { backgroundColor: sourceColor ?? colors.purple }]} /><Text style={styles.sourceText} numberOfLines={1}>{sourceLabel}</Text></View>}
  </AnimatedPressable>;
});
const styles = StyleSheet.create({
  title: { ...typography.bodyStrong, color: colors.text, marginTop: 7, lineHeight: 19 },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 3 },
  track: { height: 3, backgroundColor: colors.border, borderRadius: 2, marginTop: 7, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sourceText: { ...typography.tiny, color: colors.textMuted, flexShrink: 1 },
  badge: { position: 'absolute', right: 6, top: 6, borderRadius: 6, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { ...typography.tiny, color: '#1A0E06', fontWeight: '800' },
});
