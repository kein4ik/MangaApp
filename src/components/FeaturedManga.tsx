import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MangaSearchResult } from '@/data/sources/types';
import { imageSource } from '@/lib/imageSource';
import { sourceMeta } from '@/lib/sourceMeta';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { CoverArt } from './CoverArt';

export function FeaturedManga({ manga, compact = false, onPress }: {
  manga: MangaSearchResult; compact?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${manga.title}`}
    onPress={onPress} style={({ pressed }) => [styles.card, compact && styles.compact, pressed && { opacity: 0.9 }]}>
    {manga.coverUrl && <Image source={imageSource(manga.coverUrl)} contentFit="cover"
      blurRadius={24} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} />}
    <LinearGradient colors={['rgba(23,20,38,0.3)', 'rgba(14,11,26,0.9)']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <CoverArt uri={manga.coverUrl} title={manga.title} style={[styles.cover, compact && styles.smallCover]} />
    <View style={styles.info}>
      <View style={styles.tag}><Text style={styles.tagText} numberOfLines={1}>POPULAR ON {sourceMeta(manga.sourceId).name.toUpperCase()}</Text></View>
      <Text style={[styles.title, compact && styles.smallTitle]} numberOfLines={3}>{manga.title}</Text>
      {!!manga.status && manga.status !== 'unknown' && <Text style={styles.meta}>{manga.status}</Text>}
      {!compact && <View style={styles.cta}><Ionicons name="play" size={14} color="#1A0E06" /><Text style={styles.ctaText}>Read now</Text></View>}
    </View>
    {compact && <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, minHeight: 244, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.bgElevated },
  compact: { minHeight: 154, padding: spacing.md, gap: spacing.md },
  cover: { width: '36%', aspectRatio: 0.69, maxWidth: 160 },
  smallCover: { width: 84, aspectRatio: 0.69 },
  info: { flex: 1, minWidth: 0, gap: 8 },
  tag: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: 'rgba(255,122,48,0.16)', maxWidth: '100%' },
  tagText: { fontSize: 9, fontWeight: '800', color: '#FFB58A', letterSpacing: 0.35 },
  title: { ...typography.h2, color: colors.text },
  smallTitle: { ...typography.h3 },
  meta: { ...typography.caption, color: colors.textMuted, textTransform: 'capitalize' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 18, minHeight: 44, marginTop: 6 },
  ctaText: { ...typography.bodyStrong, color: '#1A0E06' },
});
