export const colors = {
  primary: '#0066FF',
  primaryDark: '#0052CC',
  primaryLight: '#3385FF',
  secondary: '#6B7280',
  background: '#FFFFFF',
  backgroundDark: '#111827',
  surface: '#F9FAFB',
  surfaceDark: '#1F2937',
  text: '#111827',
  textDark: '#F9FAFB',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  borderDark: '#374151',
  error: '#EF4444',
  warning: '#F59E0B',
  success: '#10B981',
  white: '#FFFFFF',
  trafficFreeFlow: '#22C55E',
  trafficSlow: '#F59E0B',
  trafficCongested: '#EF4444',
  trafficStopped: '#991B1B',
  traffic: {
    freeFlow: '#22C55E',
    slow: '#F59E0B',
    congested: '#EF4444',
    stopped: '#991B1B',
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  heading1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  heading2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 28 },
  heading3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  subtitle: { fontSize: 16, fontWeight: '500' as const, lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  round: 999,
  full: 999,
} as const;
