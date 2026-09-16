import { haversineMeters } from '../../utils/routeSnap';

/** A traffic observation positioned on (or near) the active route. */
export interface TrafficObservation {
  /** Observation position as [lng, lat]. */
  position: [number, number];
  /** Current speed ÷ free-flow speed. Values at or below the threshold are congested. */
  congestionRatio: number;
}

export interface CongestionAheadOptions {
  /** Only observations this many metres ahead of the vehicle count. */
  lookaheadMeters?: number;
  /** At or below this ratio an observation is considered congested. */
  congestionRatioThreshold?: number;
  /** Minimum number of congested observations ahead to flag a reroute. */
  minCongestedObservations?: number;
}

export interface CongestionAheadResult {
  hasSignificantCongestion: boolean;
  congestedCount: number;
}

const DEFAULT_LOOKAHEAD_METERS = 5_000;
const DEFAULT_CONGESTION_RATIO_THRESHOLD = 0.7;
const DEFAULT_MIN_CONGESTED_OBSERVATIONS = 3;

/** Cumulative distance (metres) from the route start to each vertex. */
function cumulativeDistances(coords: ReadonlyArray<[number, number]>): number[] {
  const distances = [0];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  }
  return distances;
}

/** Route distance (metres from the start) of the point projected onto the route. */
function routeDistanceOf(
  point: [number, number],
  coords: ReadonlyArray<[number, number]>,
  cumulative: ReadonlyArray<number>,
): number {
  let bestDistanceToRoute = Infinity;
  let bestRouteDistance = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projection: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const distance = haversineMeters(point, projection);
    if (distance < bestDistanceToRoute) {
      bestDistanceToRoute = distance;
      bestRouteDistance = cumulative[i] + t * (cumulative[i + 1] - cumulative[i]);
    }
  }

  return bestRouteDistance;
}

/** Route distance (metres from the start) of the point projected onto the route. */
export function projectRouteDistance(
  routeCoords: ReadonlyArray<[number, number]>,
  point: [number, number],
): number {
  if (routeCoords.length < 2) return 0;
  return routeDistanceOf(point, routeCoords, cumulativeDistances(routeCoords));
}

/**
 * Decide whether the active route has significant congestion ahead of the
 * vehicle. Only observations projected onto the route ahead of the current
 * position, within the look-ahead window, are counted — unlike the previous
 * viewport-wide check.
 */
export function evaluateCongestionAhead(
  routeCoords: ReadonlyArray<[number, number]>,
  currentPosition: [number, number],
  observations: ReadonlyArray<TrafficObservation>,
  options: CongestionAheadOptions = {},
): CongestionAheadResult {
  const lookaheadMeters = options.lookaheadMeters ?? DEFAULT_LOOKAHEAD_METERS;
  const congestionRatioThreshold =
    options.congestionRatioThreshold ?? DEFAULT_CONGESTION_RATIO_THRESHOLD;
  const minCongested = options.minCongestedObservations ?? DEFAULT_MIN_CONGESTED_OBSERVATIONS;

  if (routeCoords.length < 2 || observations.length === 0) {
    return { hasSignificantCongestion: false, congestedCount: 0 };
  }

  const cumulative = cumulativeDistances(routeCoords);
  const currentRouteDistance = routeDistanceOf(currentPosition, routeCoords, cumulative);

  let congestedCount = 0;
  for (const observation of observations) {
    if (observation.congestionRatio > congestionRatioThreshold) continue;

    const observationRouteDistance = routeDistanceOf(observation.position, routeCoords, cumulative);
    if (observationRouteDistance <= currentRouteDistance) continue;
    if (observationRouteDistance - currentRouteDistance > lookaheadMeters) continue;

    congestedCount++;
  }

  return { hasSignificantCongestion: congestedCount >= minCongested, congestedCount };
}
