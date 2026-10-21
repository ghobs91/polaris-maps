import { spacing } from './theme';

/** Minimum window width that uses the floating-panel (tablet/desktop) layout. */
export const LARGE_DISPLAY_BREAKPOINT = 768;

/**
 * Narrowest the sidebar gets. Below this the two-line place chips and result
 * rows start clipping; above it the map loses more width than the sidebar
 * earns.
 */
export const LARGE_FLOATING_PANEL_MIN_WIDTH = 360;

/**
 * Widest the sidebar gets. Apple Maps caps its macOS sidebar around 460pt even
 * on very wide windows so the map keeps the majority of the canvas.
 */
export const LARGE_FLOATING_PANEL_MAX_WIDTH = 460;

/** Share of the window width the sidebar occupies before the min/max clamp. */
export const LARGE_FLOATING_PANEL_WIDTH_RATIO = 0.3;

/**
 * Sidebar width for a given window width.
 *
 * A fixed width reads as an oversized phone sheet on a wide desktop window and
 * as a cramped strip on a narrow tablet. Scaling with the window keeps the
 * sidebar at roughly the same visual weight as the map, the way Apple Maps
 * does on macOS.
 */
export function largeFloatingPanelWidth(windowWidth: number): number {
  return Math.round(
    Math.min(
      LARGE_FLOATING_PANEL_MAX_WIDTH,
      Math.max(LARGE_FLOATING_PANEL_MIN_WIDTH, windowWidth * LARGE_FLOATING_PANEL_WIDTH_RATIO),
    ),
  );
}

/** Outer margin of the large-display floating panel. */
export const LARGE_FLOATING_PANEL_MARGIN = spacing.md;

/** Gap between the floating panel and the map content beside it. */
export const LARGE_FLOATING_PANEL_GAP = spacing.md;

/** X coordinate where map content starts, clear of the floating panel. */
export function largeMapContentLeft(windowWidth: number): number {
  return (
    LARGE_FLOATING_PANEL_MARGIN + largeFloatingPanelWidth(windowWidth) + LARGE_FLOATING_PANEL_GAP
  );
}

/** Default content-left inset (at the large-display breakpoint). */
export const LARGE_MAP_CONTENT_LEFT = largeMapContentLeft(LARGE_DISPLAY_BREAKPOINT);
