import { spacing } from './theme';

/** Minimum window width that uses the floating-panel (tablet/desktop) layout. */
export const LARGE_DISPLAY_BREAKPOINT = 768;

/** Width of the persistent search/places panel in the large-display layout. */
export const LARGE_FLOATING_PANEL_WIDTH = 380;

/** Outer margin of the large-display floating panel. */
export const LARGE_FLOATING_PANEL_MARGIN = spacing.md;

/** Gap between the floating panel and the map content beside it. */
export const LARGE_FLOATING_PANEL_GAP = spacing.md;

/** X coordinate where map content starts, clear of the floating panel. */
export const LARGE_MAP_CONTENT_LEFT =
  LARGE_FLOATING_PANEL_MARGIN + LARGE_FLOATING_PANEL_WIDTH + LARGE_FLOATING_PANEL_GAP;
