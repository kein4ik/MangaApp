import Slider from '@react-native-community/slider';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useReaderSettings } from '@/store/reader.store';
import { colors, radius, spacing } from '@/theme/colors';
import { typography } from '@/theme/typography';

import { BottomSheet } from './BottomSheet';

type Props = { visible: boolean; onClose: () => void };

export function ReaderSettingsSheet({ visible, onClose }: Props) {
  const {
    mode,
    direction,
    pageGap,
    brightness,
    keepAwake,
    setMode,
    setDirection,
    setPageGap,
    setBrightness,
    setKeepAwake,
  } = useReaderSettings();

  return (
    <BottomSheet visible={visible} title="Reader settings" onClose={onClose}>
      <Text style={styles.label}>Reading mode</Text>
      <Segment
        options={[
          { value: 'vertical', label: '↕ Vertical' },
          { value: 'paged', label: '↔ Paged' },
        ]}
        value={mode}
        onChange={(v) => setMode(v as typeof mode)}
      />

      {mode === 'paged' && (
        <>
          <Text style={styles.label}>Direction</Text>
          <Segment
            options={[
              { value: 'ltr', label: 'L → R' },
              { value: 'rtl', label: 'R → L (manga)' },
            ]}
            value={direction}
            onChange={(v) => setDirection(v as typeof direction)}
          />
        </>
      )}

      {mode === 'vertical' && (
        <>
          <Text style={styles.label}>Page gap · {pageGap}px</Text>
          <Slider
            minimumValue={0}
            maximumValue={24}
            step={2}
            value={pageGap}
            onValueChange={setPageGap}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
        </>
      )}

      <Text style={styles.label}>Brightness · {Math.round(brightness * 100)}%</Text>
      <Slider
        minimumValue={0.2}
        maximumValue={1}
        step={0.05}
        value={brightness}
        onValueChange={setBrightness}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Keep screen on</Text>
        <Switch
          value={keepAwake}
          onValueChange={setKeepAwake}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor="#fff"
        />
      </View>
    </BottomSheet>
  );
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[styles.segBtn, active && styles.segBtnActive]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  segBtnActive: { backgroundColor: colors.accent },
  segText: { ...typography.bodyStrong, color: colors.textMuted },
  segTextActive: { color: '#1A0E06' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  switchLabel: { ...typography.body, color: colors.text },
});
