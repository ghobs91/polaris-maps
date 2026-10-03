/**
 * Pure offline-routing graph selection.
 *
 * A device can hold several Valhalla graphs at once (one per downloaded metro).
 * This module picks the best graph for a set of route points without touching
 * the filesystem or the native engine, so it stays trivially testable.
 */

export interface LatLngBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutingGraphCandidate {
  /** Stable identifier (catalog region id or downloaded region id). */
  id: string;
  /** Absolute native filesystem path to the Valhalla tiles directory. */
  dir: string;
  bounds: LatLngBounds;
}

/** True when (`lat`, `lng`) falls inside `bounds`. */
export function boundsContainPoint(bounds: LatLngBounds, lat: number, lng: number): boolean {
  return (
    lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng
  );
}

/** Bounding-box area in square degrees (only used for tie-breaking). */
export function boundsArea(bounds: LatLngBounds): number {
  return Math.max(0, bounds.maxLat - bounds.minLat) * Math.max(0, bounds.maxLng - bounds.minLng);
}

/**
 * Choose the installed graph that covers the most route points. Ties break
 * toward the smallest graph (most specific coverage), so a metro graph beats a
 * state-wide one that also contains the points.
 *
 * Returns null when no candidate covers any point.
 */
export function selectRoutingGraph(
  candidates: RoutingGraphCandidate[],
  points: LatLng[],
): RoutingGraphCandidate | null {
  let best: RoutingGraphCandidate | null = null;
  let bestCovered = 0;
  let bestArea = Infinity;

  for (const candidate of candidates) {
    const covered = points.filter((p) => boundsContainPoint(candidate.bounds, p.lat, p.lng)).length;
    if (covered === 0) continue;
    const area = boundsArea(candidate.bounds);
    if (covered > bestCovered || (covered === bestCovered && area < bestArea)) {
      best = candidate;
      bestCovered = covered;
      bestArea = area;
    }
  }

  return best;
}
