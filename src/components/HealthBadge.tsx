import { StyleSheet, Text, View } from 'react-native';

import type { SourceStatus } from '@/data/sources/types';
import { colors, radius } from '@/theme/colors';
import { typography } from '@/theme/typography';

const META: Record<SourceStatus, { label: string; color: string }> = {
  online: { label: 'online', color: colors.success },
  slow: { label: 'slow', color: colors.warning },
  broken: { label: 'down', color: colors.danger },
  disabled: { label: 'off', color: colors.textFaint },
};

export function HealthDot({ status }: { status: SourceStatus }) {
  return <View style={[styles.dot, { backgroundColor: META[status].color }]} />;
}

export function HealthBadge({ status }: { status: SourceStatus }) {
  const meta = META[status];
  return (
    <View style={[styles.badge, { borderColor: meta.color }]}>
      <View style={[styles.dot, { backgroundColor: meta.color }]} />
      <Text style={[styles.label, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { ...typography.tiny, textTransform: 'uppercase' },
});
