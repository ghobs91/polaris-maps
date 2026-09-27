export const colors = {
  primary: '#007AFF',
  primaryDark: '#0059CC',
  primaryLight: '#409CFF',
  secondary: '#8E8E93',
  background: '#F2EFE9',
  backgroundDark: '#1C1C2E',
  surface: '#FFFFFF',
  surfaceDark: '#252538',
  text: '#1C1C1E',
  textDark: '#F2F2F7',
  textSecondary: '#6C6C70',
  border: 'rgba(60,60,67,0.15)',
  borderDark: 'rgba(120,120,140,0.24)',
  error: '#FF3B30',
  warning: '#FF9500',
  success: '#34C759',
  white: '#FFFFFF',
  black: '#000000',
  // Glass design tokens tuned for an Apple Maps-style liquid glass feel
  glass: {
    background: 'rgba(255,255,255,0.78)',
    backgroundDark: 'rgba(28,28,45,0.78)',
    border: 'rgba(255,255,255,0.35)',
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
  background: '#1C1C2E',
  backgroundDark: '#10101C',
  surface: '#252538',
  surfaceDark: '#1A1A2E',
  text: '#F2F2F7',
  textDark: '#FFFFFF',
  textSecondary: '#A0A0B8',
  border: 'rgba(120,120,140,0.24)',
  borderDark: 'rgba(80,80,100,0.3)',
  error: '#FF453A',
  warning: '#FF9F0A',
  success: '#30D158',
  white: '#FFFFFF',
  black: '#000000',
  glass: {
    background: 'rgba(28,28,45,0.78)',
    backgroundDark: 'rgba(20,20,35,0.82)',
    border: 'rgba(255,255,255,0.1)',
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

/**
 * Navigation HUD palette.
 *
 * The guidance surfaces stay dark over the map in both app themes — the glass
 * materials on the banner, HUD and steps list are all pinned to
 * `colorScheme="dark"` — so these are single tokens rather than the light/dark
 * pairs in {@link colors} / {@link darkColors}.
 *
 * Everything the navigation HUD paints should come from here. The point is
 * one hue per meaning: a control that means "end the trip" must not render as
 * one red on the banner, a second on the ETA bar and a third on the speed
 * badge, which is what happened while these were per-file literals.
 */
export const nav = {
  // ── Surfaces ──
  /** Turn-by-turn guidance card floating over the map. */
  surface: 'rgba(26,47,62,0.72)',
  /** Opaque form of {@link nav.surface}, for text and icons drawn on it. */
  surfaceSolid: '#1A2F3E',
  /** Bottom sheet pinned under the map (ETA bar + stops). */
  sheet: 'rgba(28,28,45,0.72)',
  /** Opaque panels that cover the map: arrival summary, incident report. */
  panel: 'rgba(28,28,30,0.98)',
  /** Speed badge plate. */
  badge: 'rgba(28,28,30,0.92)',

  // ── Text ──
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.6)',
  textMuted: 'rgba(255,255,255,0.55)',
  /** Disabled glyph in the stops list's reorder controls. */
  textDisabled: 'rgba(255,255,255,0.25)',

  // ── Lines ──
  /** Hairline separating rows inside a guidance surface. */
  separator: 'rgba(255,255,255,0.1)',
  /** Divider between lane arrows. */
  divider: 'rgba(255,255,255,0.15)',
  /** Outline on a control that needs its own edge. */
  border: 'rgba(255,255,255,0.25)',

  // ── Controls ──
  /** Tinted circular button on the glass: preview, share, add stop. */
  control: 'rgba(255,255,255,0.12)',

  // ── Semantics ──
  /**
   * Interactive accent. Every navigation surface is dark, so this is the
   * light-on-dark primary rather than the app's {@link colors.primary}.
   */
  accent: darkColors.primaryLight,
  /** Tinted fill behind an accent glyph, and the current steps-list row. */
  accentWash: 'rgba(64,156,255,0.18)',
  warning: darkColors.warning,
  warningWash: 'rgba(255,159,10,0.18)',
  danger: darkColors.error,
  /**
   * Danger colour for text on a light surface (the speed sign's white field).
   * {@link nav.danger} is tuned for dark surfaces and washes out on white,
   * the same way `colors.primary` would on the HUD's glass.
   */
  dangerInk: '#C5221F',
  /** Filled destructive control: Exit, End. */
  dangerWash: 'rgba(255,69,58,0.92)',
  /** Tinted fill behind a destructive glyph. */
  dangerSubtle: 'rgba(255,69,58,0.18)',
  success: darkColors.success,

  // ── Lane guidance ──
  // Lane arrows are drawn thin when inactive; 0.35 read as too faint at that
  // stroke weight, so the dim one sits a little above the old value.
  laneActive: '#FFFFFF',
  laneInactive: 'rgba(255,255,255,0.45)',
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

/**
 * Shared bottom-sheet design tokens. Snap points are fractions of the screen
 * height (ascending), used by every migrated sheet for consistent thresholds.
 */
export const sheet = {
  snapSmall: 0.35,
  snapMedium: 0.6,
  snapLarge: 0.92,
  /** Downward velocity (px/s) past which a drag dismisses the sheet. */
  dismissVelocity: 900,
  /** How far below the lowest snap the sheet must be dragged to dismiss. */
  dismissFraction: 0.25,
  /** Velocity projection window (s) used to pick a snap target on release. */
  projectionSeconds: 0.15,
  /** Downward drag (px) past which a floating panel collapses to its pill. */
  collapseDownPx: 30,
  /** Upward drag (px) past which a collapsed pill re-expands. */
  collapseUpPx: 20,
  spring: { damping: 22, stiffness: 220, mass: 1 },
  handle: { width: 36, height: 5, borderRadius: 3 },
  backdropOpacity: 0.4,
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
