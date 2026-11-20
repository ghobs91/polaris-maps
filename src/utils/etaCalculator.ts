import type { ETARouteSegment, ETAResult, NormalizedTrafficSegment } from '../models/traffic';
import { ROAD_CLASS_SPEEDS } from '../models/traffic';
import type { ValhallaManeuver, ValhallaRoute, ManeuverType, RoadClass } from '../models/route';
import { decodePolyline } from './polyline';
import { encode as geohashEncode, neighbors as geohashNeighbors } from './geohash';

const MATCH_THRESHOLD_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_FREE_FLOW_MPH = ROAD_CLASS_SPEEDS.secondary; // 30

/**
 * Lowest plausible live speed, as a fraction of the segment's free-flow speed.
 * A matched reading below this is almost always bad data (a zero "no data"
 * sentinel leaking into a cell average, a cell-wide average applied to one
 * point, a stale ratio) rather than real traffic, and would otherwise multiply
 * that segment's travel time by 20× or more.
 */
const MIN_LIVE_SPEED_FRACTION = 0.05;

/**
 * Hard ceiling on how much live traffic may inflate the free-flow ETA.
 * A handful of implausible readings must never turn a one-hour trip into a
 * multi-hour one; anything beyond this is untrustworthy input, not a road.
 */
const MAX_ETA_INFLATION = 4;

/**
 * A posted limit outside this range is a bad reading (a 0 sentinel, or km/h
 * that skipped the mph conversion), not a road.
 */
const MIN_PLAUSIBLE_LIMIT_MPH = 5;
const MAX_PLAUSIBLE_LIMIT_MPH = 85;

/**
 * Shortest maneuver whose own `time` is treated as a per-edge speed signal.
 * Below this the step's turn/intersection penalty dominates whatever distance
 * it covers, so distance ÷ time would price the road at walking pace.
 */
const MIN_SPEED_SIGNAL_SECONDS = 3;
const MIN_SPEED_SIGNAL_METERS = 20;

/** A derived free-flow speed is capped here; a faster reading is bad data. */
const MAX_FREE_FLOW_MPH = 80;

/**
 * Below this, distance ÷ time for a maneuver is the step's turn/intersection
 * penalty rather than a road speed, so it must not become the free-flow
 * baseline (it would swamp the posted limit on a 20 m turning step).
 */
const MIN_SPEED_SIGNAL_MPH = 8;

/**
 * Infer the most-likely road class from a Valhalla maneuver type, refined by the
 * posted limit (or, failing that, the router's own speed for the stretch).
 *
 * The old version returned `secondary` for every non-highway maneuver, which
 * priced a residential street and a 45 mph arterial identically — the road
 * class table is now only a last resort, but when it is used it should at least
 * be the right class.
 */
function inferRoadClassFromManeuver(type: ManeuverType, referenceMph?: number): RoadClass {
  switch (type) {
    case 'enter_highway':
    case 'exit_highway':
      return 'motorway';
    case 'enter_roundabout':
    case 'exit_roundabout':
      return 'secondary';
    case 'ferry':
      return 'service';
    default:
      return referenceMph != null ? roadClassFromSpeed(referenceMph) : 'secondary';
  }
}

/** Band a speed (posted limit or the router's own) into a road class. */
function roadClassFromSpeed(mph: number): RoadClass {
  if (mph >= 55) return 'motorway';
  if (mph >= 45) return 'trunk';
  if (mph >= 35) return 'primary';
  if (mph >= 28) return 'secondary';
  if (mph >= 22) return 'tertiary';
  return 'residential';
}

/**
 * The router's own uncongested speed for one maneuver, or null when its `time`
 * is too short — or too slow — to be a speed signal (or is missing).
 */
function maneuverSpeedFromRouter(maneuver: ValhallaManeuver): number | null {
  const seconds = maneuver.durationSeconds;
  const meters = maneuver.distanceMeters;
  if (!(seconds >= MIN_SPEED_SIGNAL_SECONDS) || !(meters >= MIN_SPEED_SIGNAL_METERS)) return null;
  const mph = meters / seconds / 0.44704;
  if (!Number.isFinite(mph) || mph < MIN_SPEED_SIGNAL_MPH) return null;
  return Math.min(mph, MAX_FREE_FLOW_MPH);
}

/** The posted limit Valhalla reports for a maneuver, or null when unusable. */
function maneuverSpeedLimit(maneuver: ValhallaManeuver): number | null {
  const limit = maneuver.speedLimitMph;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return null;
  if (limit < MIN_PLAUSIBLE_LIMIT_MPH || limit > MAX_PLAUSIBLE_LIMIT_MPH) return null;
  return limit;
}

export interface ManeuverFreeFlow {
  /** Baseline (uncongested) speed for this maneuver's shape range, mph. */
  speed: number;
  roadClass: RoadClass;
}

/**
 * Resolve the free-flow baseline for one maneuver, in priority order:
 *
 *  1. **The router's own answer** — a self-hosted Valhalla has no live traffic
 *     feed, so its per-maneuver `time` for this stretch *is* the uncongested
 *     estimate, and it comes from real per-edge OSM speeds. This is what the
 *     directions sheet shows, so using it keeps the driving ETA from
 *     contradicting the preview it was started from.
 *  2. **The posted limit**, when the maneuver is too short for (1).
 *  3. **The road-class table**, when there is neither.
 *
 * Before this, only (3) existed, which priced every parkway maneuver at the
 * motorway default of 70 mph: an 11 mi Long Island parkway run at a real 44 mph
 * came out as 11 min in navigation while the preview (the router's own 14 min)
 * said 14.
 */
export function resolveManeuverFreeFlow(maneuver: ValhallaManeuver): ManeuverFreeFlow {
  const fromRouter = maneuverSpeedFromRouter(maneuver);
  const limit = maneuverSpeedLimit(maneuver);
  const roadClass = inferRoadClassFromManeuver(maneuver.type, limit ?? fromRouter ?? undefined);

  if (fromRouter != null) return { speed: fromRouter, roadClass };
  if (limit != null) return { speed: limit, roadClass };
  return { speed: ROAD_CLASS_SPEEDS[roadClass] ?? DEFAULT_FREE_FLOW_MPH, roadClass };
}

/**
 * Build a lookup from polyline shape index → free-flow speed (mph) and road
 * class using the route's maneuver list. Each maneuver's beginShapeIndex..
 * endShapeIndex range is assigned that maneuver's resolved free-flow speed.
 *
 * Returns a sparse array where index `i` holds { speed, roadClass }, or
 * undefined when no maneuver covers that index.
 */
function buildManeuverSpeedMap(
  maneuvers: ValhallaManeuver[],
  coordCount: number,
): ({ speed: number; roadClass: string } | undefined)[] {
  const map: ({ speed: number; roadClass: string } | undefined)[] = new Array(coordCount);
  for (const m of maneuvers) {
    const { speed, roadClass } = resolveManeuverFreeFlow(m);
    for (let i = m.beginShapeIndex; i < m.endShapeIndex && i < coordCount; i++) {
      map[i] = { speed, roadClass };
    }
  }
  return map;
}

/** Haversine distance between two [lng, lat] points in meters. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG_TO_RAD;
  const dLng = (b[0] - a[0]) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(a[1] * DEG_TO_RAD) * Math.cos(b[1] * DEG_TO_RAD) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Midpoint of two [lng, lat] coords (simple average — accurate enough at short distances). */
function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Build a geohash6-indexed map for fast spatial lookup of traffic segments. */
function buildSpatialIndex(
  segments: NormalizedTrafficSegment[],
): Map<string, NormalizedTrafficSegment[]> {
  const index = new Map<string, NormalizedTrafficSegment[]>();
  for (const seg of segments) {
    // Index by geohash6 of first coordinate
    const hash = geohashEncode(seg.coordinates[0][1], seg.coordinates[0][0], 6);
    let bucket = index.get(hash);
    if (!bucket) {
      bucket = [];
      index.set(hash, bucket);
    }
    bucket.push(seg);
  }
  return index;
}

/**
 * Find the nearest traffic segment to a given point, searching within the same
 * and adjacent geohash6 cells. Returns the segment and distance, or null.
 */
function findNearestTrafficSegment(
  point: [number, number],
  index: Map<string, NormalizedTrafficSegment[]>,
): NormalizedTrafficSegment | null {
  const hash = geohashEncode(point[1], point[0], 6);
  const cells = [hash, ...geohashNeighbors(hash)];

  let best: NormalizedTrafficSegment | null = null;
  let bestDist = MATCH_THRESHOLD_METERS;

  for (const cell of cells) {
    const bucket = index.get(cell);
    if (!bucket) continue;
    for (const seg of bucket) {
      // Check distance from point to any coordinate on the traffic segment
      for (const coord of seg.coordinates) {
        const dist = haversineMeters(point, coord);
        if (dist < bestDist) {
          bestDist = dist;
          best = seg;
        }
      }
    }
  }

  return best;
}

/**
 * Decode a Valhalla route geometry into ETARouteSegment[].
 * Each consecutive pair of decoded coordinates forms one segment.
 * Zero-distance segments are filtered out.
 *
 * When `maneuvers` are provided, each polyline index range covered by a
 * maneuver is assigned a free-flow speed derived from the inferred road class
 * (motorway=70, trunk=55, primary=45, secondary=30, etc.). Indices not covered
 * by any maneuver fall back to `defaultSpeedMph`.
 */
export function extractRouteSegments(
  geometry: string,
  defaultSpeedMph: number = DEFAULT_FREE_FLOW_MPH,
  maneuvers?: ValhallaManeuver[],
): ETARouteSegment[] {
  const coords = decodePolyline(geometry);
  if (coords.length < 2) return [];

  // Build maneuver speed map when maneuvers are available
  const speedMap =
    maneuvers && maneuvers.length > 0 ? buildManeuverSpeedMap(maneuvers, coords.length) : undefined;

  const segments: ETARouteSegment[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const dist = haversineMeters(start, end);
    if (dist > 0) {
      const entry = speedMap?.[i];
      segments.push({
        startCoord: start,
        endCoord: end,
        distanceMeters: dist,
        freeFlowSpeedMph: entry?.speed ?? defaultSpeedMph,
        roadClass: entry?.roadClass,
      });
    }
  }
  return segments;
}

/** Format seconds into a human-readable ETA string. */
export function formatETA(seconds: number): string {
  if (seconds <= 0) return '0 min';
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours} hr ${mins} min`;
}

/**
 * Pure function: compute traffic-adjusted ETA for a route.
 *
 * For each route segment, find the nearest traffic segment within 50m
 * (using geohash6 spatial index). Use traffic current speed if matched,
 * otherwise fall back to the segment's free-flow speed.
 *
 * When a traffic segment is matched, its freeFlowSpeedMph is also used for
 * the free-flow baseline calculation (more accurate than road-class defaults).
 * Single O(n) pass over route segments.
 *
 * Live readings are bounded for safety: a matched speed never falls below
 * {@link MIN_LIVE_SPEED_FRACTION} of the segment's free flow, and the route
 * total never exceeds {@link MAX_ETA_INFLATION}× its free-flow total.
 */
export function calculateTrafficETA(
  routeSegments: ETARouteSegment[],
  trafficSegments: NormalizedTrafficSegment[],
): ETAResult {
  if (routeSegments.length === 0) {
    return {
      totalSeconds: 0,
      freeFlowTotalSeconds: 0,
      segmentCount: 0,
      matchedSegmentCount: 0,
      formatted: formatETA(0),
      freeFlowFormatted: formatETA(0),
    };
  }

  const spatialIndex = buildSpatialIndex(trafficSegments);

  let totalSeconds = 0;
  let freeFlowTotalSeconds = 0;
  let matchedCount = 0;

  for (const seg of routeSegments) {
    const mid = midpoint(seg.startCoord, seg.endCoord);

    const matched = findNearestTrafficSegment(mid, spatialIndex);

    // Determine the current speed to use for this segment:
    // - If the matched segment has a live speed (Flow Segment API), use it directly.
    // - If it only has a congestionRatio (tile sampler), derive speed from the
    //   route segment's free-flow speed × congestionRatio.
    // - Otherwise fall back to free-flow.
    let currentSpeedMph = 0;
    let baselineFreeFlow = seg.freeFlowSpeedMph;

    if (matched) {
      if (matched.currentSpeedMph > 0) {
        currentSpeedMph = matched.currentSpeedMph;
      } else if (matched.congestionRatio > 0) {
        currentSpeedMph = seg.freeFlowSpeedMph * matched.congestionRatio;
      }
      if (matched.freeFlowSpeedMph > 0) {
        baselineFreeFlow = matched.freeFlowSpeedMph;
      }
    }

    if (currentSpeedMph > 0) {
      // Floor implausible live speeds against the segment's own free flow so a
      // single bad reading cannot multiply this segment's time without bound.
      const freeFlowMph = seg.freeFlowSpeedMph > 0 ? seg.freeFlowSpeedMph : DEFAULT_FREE_FLOW_MPH;
      currentSpeedMph = Math.max(currentSpeedMph, freeFlowMph * MIN_LIVE_SPEED_FRACTION);

      totalSeconds += seg.distanceMeters / (currentSpeedMph * 0.44704);
      freeFlowTotalSeconds += seg.distanceMeters / (baselineFreeFlow * 0.44704);
      matchedCount++;
    } else {
      const freeFlowSeconds = seg.distanceMeters / (seg.freeFlowSpeedMph * 0.44704);
      totalSeconds += freeFlowSeconds;
      freeFlowTotalSeconds += freeFlowSeconds;
    }
  }

  // Cap route-wide inflation: free flow is the reference the live readings were
  // measured against, so a traffic ETA more than MAX_ETA_INFLATION times it is
  // a data problem rather than a traffic problem.
  if (freeFlowTotalSeconds > 0) {
    totalSeconds = Math.min(totalSeconds, freeFlowTotalSeconds * MAX_ETA_INFLATION);
  }

  return {
    totalSeconds,
    freeFlowTotalSeconds,
    segmentCount: routeSegments.length,
    matchedSegmentCount: matchedCount,
    formatted: formatETA(totalSeconds),
    freeFlowFormatted: formatETA(freeFlowTotalSeconds),
  };
}

/**
 * Fraction of a route's segments that matched live traffic data. 0 means the
 * ETA is a pure free-flow estimate and must not be presented as traffic-aware.
 */
export function trafficMatchRatio(result: ETAResult): number {
  return result.segmentCount > 0 ? result.matchedSegmentCount / result.segmentCount : 0;
}

/**
 * The one way to turn a `ValhallaRoute` + a traffic set into an ETA.
 *
 * Both the in-navigation refresh (`useTrafficEta`) and the directions preview
 * go through this, so the preview header and the driving HUD cannot disagree
 * about the same route.
 */
export function computeRouteTrafficEta(
  route: ValhallaRoute,
  trafficSegments: NormalizedTrafficSegment[],
): ETAResult {
  const maneuvers = route.legs.flatMap((leg) => leg.maneuvers);
  const segments = extractRouteSegments(route.geometry, undefined, maneuvers);
  return calculateTrafficETA(segments, trafficSegments);
}
