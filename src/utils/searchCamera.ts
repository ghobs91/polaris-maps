import type { ViewportBounds } from './poiSpatialFilter';

/** The centre/zoom a search should be anchored on. */
export interface SearchCamera {
  lat: number;
  lng: number;
  zoom: number;
}

/**
 * The camera a search should be anchored on.
 *
 * `mapStore.viewport` is a *command* channel for programmatic moves (locate,
 * result select, fitBounds) and is never written back when the user pans, so it
 * goes stale the moment the camera is dragged. The live camera is the viewport
 * the map publishes on settle; the fallback only covers the brief window before
 * the first region change.
 */
export function resolveSearchCamera(
  fallback: SearchCamera,
  bounds: ViewportBounds | null,
  currentZoom: number,
): SearchCamera {
  if (!bounds) return fallback;
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
    zoom: currentZoom || fallback.zoom,
  };
}
