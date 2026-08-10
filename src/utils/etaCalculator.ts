import type { ETARouteSegment, ETAResult, NormalizedTrafficSegment } from '../models/traffic';
import { ROAD_CLASS_SPEEDS } from '../models/traffic';
import type { ValhallaManeuver, ManeuverType, RoadClass } from '../models/route';
import { decodePolyline } from './polyline';
import { encode as geohashEncode, neighbors as geohashNeighbors } from './geohash';

const MATCH_THRESHOLD_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_FREE_FLOW_MPH = ROAD_CLASS_SPEEDS.secondary; // 30

/**
 * Infer the most-likely road class from a Valhalla maneuver type.
 * Uses heuristics: highway entrances/exits → motorway, roundabouts → secondary,
 * ferries → service. All other maneuvers default to secondary (moderate road).
 */
function inferRoadClassFromManeuver(type: ManeuverType): RoadClass {
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
      return 'secondary';
  }
}

/**
 * Build a lookup from polyline shape index → free-flow speed (mph) and road
 * class using the route's maneuver list. Each maneuver's beginShapeIndex..
 * endShapeIndex range is assigned a speed and road class based on inferred type.
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
    const roadClass = inferRoadClassFromManeuver(m.type);
    const speed = ROAD_CLASS_SPEEDS[roadClass] ?? DEFAULT_FREE_FLOW_MPH;
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
      totalSeconds += seg.distanceMeters / (currentSpeedMph * 0.44704);
      freeFlowTotalSeconds += seg.distanceMeters / (baselineFreeFlow * 0.44704);
      matchedCount++;
    } else {
      const freeFlowSeconds = seg.distanceMeters / (seg.freeFlowSpeedMph * 0.44704);
      totalSeconds += freeFlowSeconds;
      freeFlowTotalSeconds += freeFlowSeconds;
    }
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
