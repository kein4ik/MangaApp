/**
 * Dark, premium reader palette per the architecture plan:
 * soft purple/black background, orange accent for progress and active actions.
 */
export const colors = {
  bg: '#0E0B1A',
  bgElevated: '#171426',
  card: '#1E1B30',
  cardPressed: '#272338',
  border: '#2C2840',

  text: '#F2F0FA',
  textMuted: '#A6A0C2',
  textFaint: '#6E6890',

  accent: '#FF7A30', // orange — progress, active actions
  accentMuted: '#7A3F1E',

  purple: '#7C5CFC',

  success: '#3FB97A',
  warning: '#E5B53A',
  danger: '#E5544B',

  overlay: 'rgba(0,0,0,0.6)',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
