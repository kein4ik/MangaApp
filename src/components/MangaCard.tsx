import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { imageSource } from '@/lib/imageSource';
import { colors, radius } from '@/theme/colors';
import { typography } from '@/theme/typography';

type Props = {
  title: string;
  coverUrl?: string | null;
  subtitle?: string;
  /** 0..1 reading progress; renders an orange bar when > 0. */
  progress?: number;
  /** Optional source badge shown on the cover (e.g. "MangaLib"). */
  sourceLabel?: string;
  sourceColor?: string;
  width: number;
  onPress: () => void;
};

export function MangaCard({
  title,
  coverUrl,
  subtitle,
  progress = 0,
  sourceLabel,
  sourceColor,
  width,
  onPress,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.cover, { width, height: width * 1.45 }]}>
        {coverUrl ? (
          <Image
            source={imageSource(coverUrl)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <Text style={styles.placeholderText}>{title.slice(0, 1)}</Text>
          </View>
        )}
        {sourceLabel && (
          <View style={[styles.sourceBadge, { backgroundColor: sourceColor ?? colors.purple }]}>
            <Text style={styles.sourceBadgeText} numberOfLines={1}>
              {sourceLabel}
            </Text>
          </View>
        )}
        {progress > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(progress, 1) * 100}%` }]} />
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  placeholderText: {
    ...typography.h1,
    color: colors.textFaint,
  },
  sourceBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    maxWidth: '85%',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  sourceBadgeText: { ...typography.tiny, color: '#fff', fontWeight: '700' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.accent,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: 6,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
});
