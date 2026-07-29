export const colors = {
  primary: '#007AFF',
  primaryDark: '#0059CC',
  primaryLight: '#409CFF',
  secondary: '#8E8E93',
  background: '#F2F2F7',
  backgroundDark: '#000000',
  surface: '#FFFFFF',
  surfaceDark: '#1C1C1E',
  text: '#000000',
  textDark: '#FFFFFF',
  textSecondary: '#6C6C70',
  border: '#C6C6C8',
  borderDark: '#38383A',
  error: '#FF3B30',
  warning: '#FF9500',
  success: '#34C759',
  white: '#FFFFFF',
  black: '#000000',
  // Glass design tokens
  glass: {
    background: 'rgba(255,255,255,0.72)',
    backgroundDark: 'rgba(28,28,30,0.72)',
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
  primary: '#0A84FF',
  primaryDark: '#0066CC',
  primaryLight: '#409CFF',
  secondary: '#8E8E93',
  background: '#000000',
  backgroundDark: '#000000',
  surface: '#1C1C1E',
  surfaceDark: '#1C1C1E',
  text: '#FFFFFF',
  textDark: '#FFFFFF',
  textSecondary: '#8E8E93',
  border: '#38383A',
  borderDark: '#38383A',
  error: '#FF453A',
  warning: '#FF9F0A',
  success: '#30D158',
  white: '#FFFFFF',
  black: '#000000',
  glass: {
    background: 'rgba(28,28,30,0.72)',
    backgroundDark: 'rgba(28,28,30,0.72)',
    border: 'rgba(255,255,255,0.08)',
    shadow: 'rgba(0,0,0,0.5)',
  },
  tabBar: {
    active: '#0A84FF',
    inactive: '#8E8E93',
    background: 'rgba(22,22,23,0.92)',
  },
  trafficFreeFlow: '#30D158',
  trafficSlow: '#FF9F0A',
  trafficCongested: '#FF453A',
  trafficStopped: '#991B1B',
  traffic: {
    freeFlow: '#30D158',
    slow: '#FF9F0A',
    congested: '#FF453A',
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
  /** iOS large title used by the Settings page heading (34pt, bold). */
  largeTitle: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41 },
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
  /** iOS Settings list uses a chunky radius on the grouped section container. */
  iosGrouped: 10,
  round: 999,
  full: 999,
} as const;

export const iosListGroup = {
  /** Section background in the Apple Settings grouped list. */
  sectionBackground: '#1C1C1E',
  /** Page background under the grouped list (true black in dark mode). */
  pageBackground: '#000000',
  /** Hairline separator between rows. */
  separator: 'rgba(84,84,88,0.34)',
  /** Section header text color. */
  sectionHeader: '#8E8E93',
  /** Tappable-row highlight on press. */
  pressedOverlay: 'rgba(255,255,255,0.06)',
  /** Background of a "destructive" row (red text). */
  destructive: '#FF453A',
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
