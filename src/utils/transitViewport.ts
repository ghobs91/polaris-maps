/**
 * Viewport filtering for transit route lines.
 *
 * The transit caches accumulate lines across every tile the user has ever
 * viewed.  Rendering the whole accumulated set means the JS→native bridge
 * re-serialises geometry for cities the user has long since left, and the
 * cost grows with every pan.  These helpers keep only the lines that can
 * actually be seen (plus a padding margin so lines don't pop in at the edge).
 */

import type { TransitRouteLine } from '../models/transit';
import type { ViewportBounds } from './poiSpatialFilter';

export interface TransitLineBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Line objects are stable across fetches, so bounds are computed once. */
const lineBoundsCache = new WeakMap<TransitRouteLine, TransitLineBounds | null>();

/** Bounding box of a line's geometry, or null when it has no points. */
export function transitLineBounds(line: TransitRouteLine): TransitLineBounds | null {
  const cached = lineBoundsCache.get(line);
  if (cached !== undefined) return cached;

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const segment of line.geometry) {
    for (const [lng, lat] of segment) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  const bounds = minLat === Infinity ? null : { minLat, minLng, maxLat, maxLng };
  lineBoundsCache.set(line, bounds);
  return bounds;
}

/**
 * Keep only lines whose geometry intersects `bounds`, expanded by
 * `padRatio` on each axis (default 25%, minimum ~0.01°) so routes that
 * leave and re-enter the viewport stay continuous.
 */
export function filterTransitLinesToBounds(
  lines: TransitRouteLine[],
  bounds: ViewportBounds,
  padRatio = 0.25,
): TransitRouteLine[] {
  const latPad = Math.max((bounds.maxLat - bounds.minLat) * padRatio, 0.01);
  const lngPad = Math.max((bounds.maxLng - bounds.minLng) * padRatio, 0.01);

  const minLat = bounds.minLat - latPad;
  const maxLat = bounds.maxLat + latPad;
  const minLng = bounds.minLng - lngPad;
  const maxLng = bounds.maxLng + lngPad;

  return lines.filter((line) => {
    const b = transitLineBounds(line);
    if (!b) return false;
    return b.maxLat >= minLat && b.minLat <= maxLat && b.maxLng >= minLng && b.minLng <= maxLng;
  });
}
