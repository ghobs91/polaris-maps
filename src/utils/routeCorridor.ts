/**
 * "Along the route" helpers for the add-stop flow.
 *
 * A suggested stop is only useful when reaching it barely changes the drive, so
 * the add-stop sheet keeps results near the remaining route ahead of the driver
 * and orders them by the time they add. Distances are measured against the
 * decoded route polyline ([lng, lat] pairs).
 */

import { haversineMeters } from './routeSnap';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Radius around the remaining route that still counts as "along the route". */
export const ROUTE_CORRIDOR_METERS = 2000;

/** Off-corridor suggestions kept when nothing sits near the route. */
export const ROUTE_CORRIDOR_FALLBACK_LIMIT = 3;

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * Nearest distance in meters from a point to one polyline segment, using a
 * local planar approximation (accurate well past the corridor radius).
 */
function distanceToSegmentMeters(
  lat: number,
  lng: number,
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
): number {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  // Segment endpoints relative to the query point (x = east, y = north).
  const ax = (fromLng - lng) * metersPerDegreeLng;
  const ay = (fromLat - lat) * METERS_PER_DEGREE_LAT;
  const bx = (toLng - lng) * metersPerDegreeLng;
  const by = (toLat - lat) * METERS_PER_DEGREE_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/** Nearest distance in meters from a point to a decoded route polyline. */
export function distanceToRouteMeters(
  lat: number,
  lng: number,
  coords: Array<[number, number]>,
): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversineMeters([lng, lat], coords[0]);

  let nearest = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const [fromLng, fromLat] = coords[i - 1];
    const [toLng, toLat] = coords[i];
    const distance = distanceToSegmentMeters(lat, lng, fromLng, fromLat, toLng, toLat);
    if (distance < nearest) nearest = distance;
    if (nearest === 0) break;
  }
  return nearest;
}

/** Index of the polyline point closest to `point`. */
function nearestPolylineIndex(coords: Array<[number, number]>, point: LatLng): number {
  const here: [number, number] = [point.lng, point.lat];
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const distance = haversineMeters(here, coords[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Trims the polyline to the stretch still ahead of `origin`, so places the
 * driver has already passed can't win on a short detour.
 */
function coordsAheadOf(coords: Array<[number, number]>, origin: LatLng): Array<[number, number]> {
  if (coords.length < 2) return coords;
  const index = nearestPolylineIndex(coords, origin);
  return coords.slice(index);
}

/**
 * Keeps the results within `maxMeters` of the route ahead of `origin`,
 * preserving the order they arrived in. When nothing is that close (sparse
 * roads), falls back to the few results nearest the route so the sheet is never
 * empty and the map does not have to fit a continent.
 */
export function selectStopsAlongRoute<T extends LatLng>(
  results: T[],
  coords: Array<[number, number]>,
  origin?: LatLng | null,
  maxMeters: number = ROUTE_CORRIDOR_METERS,
): T[] {
  if (results.length === 0) return results;
  const ahead = origin ? coordsAheadOf(coords, origin) : coords;
  if (ahead.length < 2) return results;

  const scored = results.map((result) => ({
    result,
    distance: distanceToRouteMeters(result.lat, result.lng, ahead),
  }));

  const within = scored.filter((entry) => entry.distance <= maxMeters);
  if (within.length > 0) return within.map((entry) => entry.result);

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, ROUTE_CORRIDOR_FALLBACK_LIMIT)
    .map((entry) => entry.result);
}
