import type { NormalizedTrafficSegment } from '../../models/traffic';
import { haversineMeters } from '../../utils/routeSnap';

/** Default route color when no traffic data is available. */
export const DEFAULT_ROUTE_COLOR = '#4A8CFF';

/** Display colors for the ETA number based on overall route traffic. */
export const ETA_COLOR_GREEN = '#4ADE80';
export const ETA_COLOR_ORANGE = '#FF9500';
export const ETA_COLOR_RED = '#FF3B30';

/**
 * Proximity threshold in degrees (~400 m at mid-latitudes).
 * Wider than half the sample spacing so every route midpoint falls within
 * range of a sampled point or the segment's own geometry extent.
 */
const MATCH_THRESHOLD_DEG = 0.004;

/** Map a congestion ratio (0–1) to a traffic color. */
export function congestionColor(ratio: number): string {
  if (ratio >= 0.75) return '#4A8CFF'; // blue — free flow (same as default route color)
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

/**
 * Compute the bearing (0–360°) from point a to point b.
 * Returns degrees clockwise from north.
 */
function bearingDeg(a: [number, number], b: [number, number]): number {
  const dlng = b[0] - a[0];
  const dlat = b[1] - a[1];
  const rad = Math.atan2(dlng, dlat);
  return ((rad * 180) / Math.PI + 360) % 360;
}

/**
 * Effective distance that penalizes segments whose direction differs
 * significantly from the route's direction. In dense urban grids, the
 * closest segment by pure distance may be on a parallel street with
 * completely different traffic conditions.
 *
 * Returns the squared distance multiplied by a penalty factor when the
 * bearing difference exceeds 45°.
 */
function penalizedDistSq(
  mid: [number, number],
  pt: [number, number],
  routeBearing: number,
  segBearing: number,
): number {
  const dSq = distSq(mid, pt);
  const bearingDiff = Math.abs(routeBearing - segBearing);
  const diff = Math.min(bearingDiff, 360 - bearingDiff);
  // Strong penalty when directions differ by > 45° — effectively pushes
  // the algorithm to prefer same-direction segments even if a cross-street
  // segment is physically closer.
  if (diff > 45) {
    return dSq * 4; // 2x in linear distance terms
  }
  if (diff > 20) {
    return dSq * 1.5;
  }
  return dSq;
}

/**
 * Minimum squared distance from point p to line segment a–b.
 * This handles the case where a segment has sparse endpoints but the route
 * runs along the middle of it.
 */
function pointToSegDistSq(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distSq(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const dpx = p[0] - projX;
  const dpy = p[1] - projY;
  return dpx * dpx + dpy * dpy;
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
 * every route coordinate pair to nearby {@link NormalizedTrafficSegment}s.
 *
 * Consecutive pairs with the same color are merged into a single feature to
 * reduce the number of GeoJSON features while keeping precise coloring.
 */
export function buildRouteTrafficGeoJSON(
  routeCoords: [number, number][],
  segments: NormalizedTrafficSegment[],
): TrafficFeatureCollection {
  const empty: TrafficFeatureCollection = { type: 'FeatureCollection', features: [] };
  if (routeCoords.length < 2) return empty;

  const thresholdSq = MATCH_THRESHOLD_DEG * MATCH_THRESHOLD_DEG;
  const features: TrafficFeatureCollection['features'] = [];

  // Pre-compute each segment's bearing so we only calculate it once
  const segBearings = segments.map((seg) => {
    const coords = seg.coordinates;
    if (coords.length >= 2) {
      return bearingDeg(coords[0], coords[coords.length - 1]);
    }
    return -1; // single-point segment, no bearing
  });

  let runColor: string | null = null;
  let runCoords: [number, number][] = [];

  const flushRun = () => {
    if (runColor && runCoords.length >= 2) {
      features.push({
        type: 'Feature' as const,
        properties: { color: runColor },
        geometry: { type: 'LineString' as const, coordinates: runCoords },
      });
    }
  };

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const mid: [number, number] = [
      (routeCoords[i][0] + routeCoords[i + 1][0]) / 2,
      (routeCoords[i][1] + routeCoords[i + 1][1]) / 2,
    ];

    // Bearing of this route segment
    const routeBearing = bearingDeg(routeCoords[i], routeCoords[i + 1]);

    let bestDistSq = Infinity;
    let bestRatio = -1;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const segBearing = segBearings[s];

      // Check distance to each coordinate point with bearing penalty
      for (const pt of seg.coordinates) {
        const d =
          segBearing >= 0 ? penalizedDistSq(mid, pt, routeBearing, segBearing) : distSq(mid, pt);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestRatio = seg.congestionRatio;
        }
      }
      // Also check distance to line segments between consecutive coordinates
      for (let j = 0; j < seg.coordinates.length - 1; j++) {
        let d = pointToSegDistSq(mid, seg.coordinates[j], seg.coordinates[j + 1]);
        if (segBearing >= 0) {
          // Apply the same bearing penalty to line-segment distance
          const bearingDiff = Math.abs(routeBearing - segBearing);
          const diff = Math.min(bearingDiff, 360 - bearingDiff);
          if (diff > 45) d *= 4;
          else if (diff > 20) d *= 1.5;
        }
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

    if (color === runColor) {
      // Extend current run
      runCoords.push(routeCoords[i + 1]);
    } else {
      // Flush previous run, start new one
      flushRun();
      runColor = color;
      runCoords = [routeCoords[i], routeCoords[i + 1]];
    }
  }
  flushRun();

  return { type: 'FeatureCollection', features };
}

/**
 * Compute a distance-weighted average congestion ratio across route sections
 * that have matching traffic data, then map it to a single display color.
 *
 * Sections without nearby traffic data are **excluded** from the average so
 * they don't dilute the real congestion. If no segments match at all, the
 * function falls back to green (no data).
 *
 * Returns one of:
 * - {@link ETA_COLOR_GREEN} (overall free flow)
 * - {@link ETA_COLOR_ORANGE} (overall moderate congestion)
 * - {@link ETA_COLOR_RED} (overall heavy / stopped traffic)
 */
export function averageRouteTrafficColor(
  routeCoords: [number, number][],
  segments: NormalizedTrafficSegment[],
): string {
  if (routeCoords.length < 2) return ETA_COLOR_GREEN;

  const thresholdSq = MATCH_THRESHOLD_DEG * MATCH_THRESHOLD_DEG;

  // Pre-compute segment bearings
  const segBearings = segments.map((seg) => {
    const coords = seg.coordinates;
    if (coords.length >= 2) {
      return bearingDeg(coords[0], coords[coords.length - 1]);
    }
    return -1;
  });

  let totalWeightedRatio = 0;
  let totalWeight = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const a = routeCoords[i];
    const b = routeCoords[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const routeBearing = bearingDeg(a, b);

    let bestDistSq = Infinity;
    let bestRatio = -1;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const segBearing = segBearings[s];

      for (const pt of seg.coordinates) {
        const d =
          segBearing >= 0 ? penalizedDistSq(mid, pt, routeBearing, segBearing) : distSq(mid, pt);
        if (d < bestDistSq) {
          bestDistSq = d;
          bestRatio = seg.congestionRatio;
        }
      }
      for (let j = 0; j < seg.coordinates.length - 1; j++) {
        let d = pointToSegDistSq(mid, seg.coordinates[j], seg.coordinates[j + 1]);
        if (segBearing >= 0) {
          const bearingDiff = Math.abs(routeBearing - segBearing);
          const diff = Math.min(bearingDiff, 360 - bearingDiff);
          if (diff > 45) d *= 4;
          else if (diff > 20) d *= 1.5;
        }
        if (d < bestDistSq) {
          bestDistSq = d;
          bestRatio = seg.congestionRatio;
        }
      }
    }

    // Only include sections that actually matched traffic data in the average.
    // Sections without data are skipped so they don't dilute the real congestion.
    if (bestDistSq <= thresholdSq && bestRatio >= 0) {
      const dist = haversineMeters(a, b);
      totalWeightedRatio += bestRatio * dist;
      totalWeight += dist;
    }
  }

  // No traffic data matched at all — fall back to green (no data).
  if (totalWeight === 0) return ETA_COLOR_GREEN;

  const avgRatio = totalWeightedRatio / totalWeight;

  if (avgRatio >= 0.75) return ETA_COLOR_GREEN;
  if (avgRatio >= 0.25) return ETA_COLOR_ORANGE;
  return ETA_COLOR_RED;
}
