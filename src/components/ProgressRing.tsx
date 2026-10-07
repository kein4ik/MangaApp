import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/theme/colors';

/**
 * Small circular read-progress indicator for cover corners. Reads at a glance
 * ("how far in am I?") far better than the 3px bar it replaces, and doesn't
 * cover artwork.
 */
export function ProgressRing({
  progress,
  size = 26,
  stroke = 3,
}: {
  /** 0..1 */
  progress: number;
  size?: number;
  stroke?: number;
}) {
  const clamped = Math.max(0, Math.min(progress, 1));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      {/* Track */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={stroke}
        fill="rgba(0,0,0,0.35)"
      />
      {/* Filled arc — rotated so it starts at 12 o'clock. */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={colors.accent}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
