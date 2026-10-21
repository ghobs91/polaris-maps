import {
  LARGE_FLOATING_PANEL_MARGIN,
  LARGE_MAP_CONTENT_LEFT,
  largeMapContentLeft,
} from '../constants/layout';

export interface MapOverlayInsets {
  left: number;
  right: number;
}

/**
 * Horizontal insets for map overlays anchored to the screen edges.
 *
 * On large displays the search/places panel permanently occupies the left
 * edge, so drawers and cards must start to its right instead of sliding
 * underneath it. Phone layouts keep the full width.
 *
 * `windowWidth` lets the inset track the panel's responsive width; callers
 * without window dimensions get the breakpoint-width default.
 */
export function getMapOverlayInsets(
  isLargeDisplay: boolean,
  windowWidth?: number,
): MapOverlayInsets {
  if (!isLargeDisplay) return { left: 0, right: 0 };
  return {
    left: windowWidth === undefined ? LARGE_MAP_CONTENT_LEFT : largeMapContentLeft(windowWidth),
    right: LARGE_FLOATING_PANEL_MARGIN,
  };
}
