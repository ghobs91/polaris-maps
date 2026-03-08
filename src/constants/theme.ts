export const colors = {
  primary: '#007AFF',
  primaryDark: '#0059CC',
  primaryLight: '#409CFF',
  secondary: '#8E8E93',
  background: '#F2F2F7',
  backgroundDark: '#111827',
  surface: '#FFFFFF',
  surfaceDark: '#1F2937',
  text: '#000000',
  textDark: '#F9FAFB',
  textSecondary: '#8E8E93',
  border: '#C6C6C8',
  borderDark: '#374151',
  error: '#FF3B30',
  warning: '#FF9500',
  success: '#34C759',
  white: '#FFFFFF',
  black: '#000000',
  // Glass design tokens
  glass: {
    background: 'rgba(255,255,255,0.72)',
    backgroundDark: 'rgba(30,30,30,0.72)',
    border: 'rgba(255,255,255,0.3)',
    shadow: 'rgba(0,0,0,0.08)',
  },
  tabBar: {
    active: '#007AFF',
    inactive: '#8E8E93',
    background: 'rgba(249,249,249,0.94)',
  },
  trafficFreeFlow: '#34C759',
  trafficSlow: '#FF9500',
  trafficCongested: '#FF3B30',
  trafficStopped: '#991B1B',
  traffic: {
    freeFlow: '#34C759',
    slow: '#FF9500',
    congested: '#FF3B30',
    stopped: '#991B1B',
  },
} as const;

export const darkColors = {
  primary: '#409CFF',
  primaryDark: '#007AFF',
  primaryLight: '#66B2FF',
  secondary: '#636366',
  background: '#111827',
  backgroundDark: '#111827',
  surface: '#1F2937',
  surfaceDark: '#1F2937',
  text: '#F9FAFB',
  textDark: '#F9FAFB',
  textSecondary: '#9CA3AF',
  border: '#374151',
  borderDark: '#374151',
  error: '#FF453A',
  warning: '#FF9F0A',
  success: '#32D74B',
  white: '#FFFFFF',
  black: '#000000',
  glass: {
    background: 'rgba(30,30,30,0.82)',
    backgroundDark: 'rgba(30,30,30,0.82)',
    border: 'rgba(255,255,255,0.1)',
    shadow: 'rgba(0,0,0,0.4)',
  },
  tabBar: {
    active: '#409CFF',
    inactive: '#636366',
    background: 'rgba(28,28,30,0.94)',
  },
  trafficFreeFlow: '#34C759',
  trafficSlow: '#FF9500',
  trafficCongested: '#FF3B30',
  trafficStopped: '#991B1B',
  traffic: {
    freeFlow: '#34C759',
    slow: '#FF9500',
    congested: '#FF3B30',
    stopped: '#991B1B',
  },
} as const;

export type AppColors = typeof colors;

export type AppColorsLoose = {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  background: string;
  backgroundDark: string;
  surface: string;
  surfaceDark: string;
  text: string;
  textDark: string;
  textSecondary: string;
  border: string;
  borderDark: string;
  error: string;
  warning: string;
  success: string;
  white: string;
  black: string;
  glass: { background: string; backgroundDark: string; border: string; shadow: string };
  tabBar: { active: string; inactive: string; background: string };
  trafficFreeFlow: string;
  trafficSlow: string;
  trafficCongested: string;
  trafficStopped: string;
  traffic: { freeFlow: string; slow: string; congested: string; stopped: string };
};

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
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  round: 999,
  full: 999,
} as const;

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;
