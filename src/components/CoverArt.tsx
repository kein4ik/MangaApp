import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { imageSource } from '@/lib/imageSource';
import { colors, radius } from '@/theme/colors';

/** Real source artwork, with a quiet fallback for missing or broken covers. */
export function CoverArt({ uri, title, style }: {
  uri?: string | null; title: string; style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={[styles.cover, style]}>
    <View style={styles.fallback} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.initial}>{title.trim().slice(0, 1).toUpperCase()}</Text></View>
    {!!uri && !failed && <Image source={imageSource(uri)} style={StyleSheet.absoluteFill} contentFit="cover"
      recyclingKey={uri} cachePolicy="memory-disk" transition={120} onError={() => setFailed(true)} />}
  </View>;
}
const styles = StyleSheet.create({
  cover: { overflow: 'hidden', borderRadius: radius.md, backgroundColor: colors.card },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#26223C' },
  initial: { fontSize: 40, fontWeight: '700', color: '#A6A0C2' },
});
