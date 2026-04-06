import type { NormalizedTrafficSegment } from '../../models/traffic';

/** Default route color when no traffic data is available. */
export const DEFAULT_ROUTE_COLOR = '#4A90D9';

/** Maximum number of chunks the route is divided into for traffic matching. */
const MAX_CHUNKS = 25;

/**
 * Proximity threshold in degrees (~100 m at mid-latitudes).
 * Route points farther than this from any traffic segment keep the default blue.
 */
const MATCH_THRESHOLD_DEG = 0.001;

/** Map a congestion ratio (0–1) to a traffic color. */
export function congestionColor(ratio: number): string {
  if (ratio >= 0.75) return '#00C853'; // green — free flow
  if (ratio >= 0.5) return '#FFD600'; // yellow — slow
  if (ratio >= 0.25) return '#FF6D00'; // orange — congested
  return '#D50000'; // dark red — stopped / heavy delay
}

/** Squared Euclidean distance in degrees (avoids sqrt for comparisons). */
function distSq(a: [number, number], b: [number, number]): number {
  const dlng = a[0] - b[0];
  const dlat = a[1] - b[1];
  return dlng * dlng + dlat * dlat;
}

export type TrafficFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { color: string };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

/**
 * Build a GeoJSON FeatureCollection of color-coded line segments by matching
 * route coordinates to nearby {@link NormalizedTrafficSegment}s.
 *
 * Segments that match within {@link MATCH_THRESHOLD_DEG} are colored using
 * {@link congestionColor}; unmatched segments keep the default blue.
 */
export function buildRouteTrafficGeoJSON(
  routeCoords: [number, number][],
  segments: NormalizedTrafficSegment[],
): TrafficFeatureCollection {
  const empty: TrafficFeatureCollection = { type: 'FeatureCollection', features: [] };
  if (routeCoords.length < 2) return empty;

  const step = Math.max(1, Math.floor(routeCoords.length / MAX_CHUNKS));
  const thresholdSq = MATCH_THRESHOLD_DEG * MATCH_THRESHOLD_DEG;
  const features: TrafficFeatureCollection['features'] = [];

  for (let i = 0; i < routeCoords.length - 1; i += step) {
    const end = Math.min(i + step, routeCoords.length - 1);
    const midIdx = Math.floor((i + end) / 2);
    const mid = routeCoords[midIdx];

    let bestDistSq = Infinity;
    let bestRatio = -1;

    for (const seg of segments) {
      for (const pt of seg.coordinates) {
        const d = distSq(mid, pt);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestRatio = seg.congestionRatio;
        }
      }
    }

    const color =
      bestDistSq <= thresholdSq && bestRatio >= 0
        ? congestionColor(bestRatio)
        : DEFAULT_ROUTE_COLOR;

    features.push({
      type: 'Feature' as const,
      properties: { color },
      geometry: {
        type: 'LineString' as const,
        coordinates: routeCoords.slice(i, end + 1),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
