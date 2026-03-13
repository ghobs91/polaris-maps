import type { ETARouteSegment, ETAResult, NormalizedTrafficSegment } from '../models/traffic';
import { ROAD_CLASS_SPEEDS } from '../models/traffic';
import { decodePolyline } from './polyline';
import { encode as geohashEncode, neighbors as geohashNeighbors } from './geohash';

const MATCH_THRESHOLD_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_FREE_FLOW_KMH = ROAD_CLASS_SPEEDS.secondary; // 50

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
 */
export function extractRouteSegments(
  geometry: string,
  defaultSpeedKmh: number = DEFAULT_FREE_FLOW_KMH,
): ETARouteSegment[] {
  const coords = decodePolyline(geometry);
  if (coords.length < 2) return [];

  const segments: ETARouteSegment[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const dist = haversineMeters(start, end);
    if (dist > 0) {
      segments.push({
        startCoord: start,
        endCoord: end,
        distanceMeters: dist,
        freeFlowSpeedKmh: defaultSpeedKmh,
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
 * (using geohash6 spatial index). Use traffic speed if matched, otherwise
 * fall back to free-flow speed. Single O(n) pass over route segments.
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
    const freeFlowSeconds = seg.distanceMeters / (seg.freeFlowSpeedKmh / 3.6);
    freeFlowTotalSeconds += freeFlowSeconds;

    const matched = findNearestTrafficSegment(mid, spatialIndex);
    if (matched && matched.currentSpeedKmh > 0) {
      totalSeconds += seg.distanceMeters / (matched.currentSpeedKmh / 3.6);
      matchedCount++;
    } else {
      totalSeconds += freeFlowSeconds;
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
