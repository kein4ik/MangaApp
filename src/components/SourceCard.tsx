import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SourceInfo } from '@/data/sources/types';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

import { HealthDot } from './HealthBadge';

type Props = {
  source: SourceInfo;
  active: boolean;
  accent: string;
  onPress: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  slow: 'Slow',
  broken: 'Down',
  disabled: 'Off',
};

export function SourceCard({ source, active, accent, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        active && styles.cardActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      {active && (
        <View style={styles.activeTag}>
          <Text style={styles.activeTagText}>✓</Text>
        </View>
      )}

      <View style={[styles.avatar, { backgroundColor: accent }]}>
        <Text style={styles.avatarText}>{source.name.slice(0, 1).toUpperCase()}</Text>
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {source.name}
      </Text>

      <View style={styles.metaRow}>
        <HealthDot status={source.status} />
        <Text style={styles.meta}>{STATUS_LABEL[source.status] ?? source.status}</Text>
      </View>

      <Text style={styles.caps} numberOfLines={1}>
        {source.supportsReading ? '📖 Reading' : 'ℹ️ Info only'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 132,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  cardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.cardPressed,
  },
  activeTag: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTagText: { ...typography.tiny, color: '#1A0E06', fontWeight: '800' },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h3, color: '#fff', fontWeight: '800' },
  name: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...typography.caption, color: colors.textMuted },
  caps: { ...typography.caption, color: colors.textFaint },
});
