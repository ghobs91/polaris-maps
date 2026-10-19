import { LARGE_FLOATING_PANEL_MARGIN, LARGE_MAP_CONTENT_LEFT } from '../constants/layout';

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
 */
export function getMapOverlayInsets(isLargeDisplay: boolean): MapOverlayInsets {
  return isLargeDisplay
    ? { left: LARGE_MAP_CONTENT_LEFT, right: LARGE_FLOATING_PANEL_MARGIN }
    : { left: 0, right: 0 };
}
