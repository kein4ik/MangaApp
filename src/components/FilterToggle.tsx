import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/theme/colors';
import { typography } from '@/theme/typography';

export type HistoryFilter = 'all' | 'source';

type Props = {
  value: HistoryFilter;
  onChange: (v: HistoryFilter) => void;
  /** Label for the "current source" segment, e.g. "MangaLib". */
  currentLabel: string;
};

/** Small segmented control: All ⇆ <current source>. */
export function FilterToggle({ value, onChange, currentLabel }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => onChange('all')}
        style={[styles.seg, value === 'all' && styles.segActive]}
      >
        <Text style={[styles.txt, value === 'all' && styles.txtActive]}>All</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('source')}
        style={[styles.seg, value === 'source' && styles.segActive]}
      >
        <Text style={[styles.txt, value === 'source' && styles.txtActive]} numberOfLines={1}>
          {currentLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  seg: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  segActive: { backgroundColor: colors.accent },
  txt: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  txtActive: { color: '#1A0E06' },
});
