/** Compute bearing (in degrees, 0=north, CW) between two [lng,lat] points. */
export function computeBearing(from: [number, number], to: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(to[0] - from[0]);
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Approximate distance in meters between two [lng, lat] points (Haversine). */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Snap a GPS coordinate to the nearest point on the route polyline.
 * Returns the snapped [lng, lat], bearing, the shape index of the segment,
 * and the distance in meters from the original position to the snapped point.
 */
export function snapToRoute(
  pos: [number, number],
  coords: [number, number][],
): { snapped: [number, number]; bearing: number; segmentIndex: number; distanceMeters: number } {
  let bestDist = Infinity;
  let bestPoint: [number, number] = pos;
  let bestIdx = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    // Project pos onto segment a→b using parameter t ∈ [0,1]
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const dist = haversineMeters(pos, proj);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = proj;
      bestIdx = i;
    }
  }

  const bearing = computeBearing(coords[bestIdx], coords[Math.min(bestIdx + 1, coords.length - 1)]);
  return {
    snapped: bestPoint,
    bearing,
    segmentIndex: bestIdx,
    distanceMeters: bestDist === Infinity ? 0 : bestDist,
  };
}

/** Threshold in meters beyond which the user is considered off-route. */
export const OFF_ROUTE_THRESHOLD_METERS = 50;

/**
 * Number of consecutive off-route GPS readings required before triggering a reroute.
 * Prevents false positives from GPS drift or brief signal loss.
 */
export const OFF_ROUTE_CONSECUTIVE_COUNT = 3;

/**
 * Determine whether the user has deviated from the route.
 * Returns true when `consecutiveOffRouteCount` consecutive GPS readings
 * have all been farther than `OFF_ROUTE_THRESHOLD_METERS` from the route.
 */
export function isOffRoute(distanceToRoute: number, consecutiveOffRouteCount: number): boolean {
  return (
    distanceToRoute > OFF_ROUTE_THRESHOLD_METERS &&
    consecutiveOffRouteCount >= OFF_ROUTE_CONSECUTIVE_COUNT
  );
}

/**
 * Compute the remaining route distance (meters) from a snapped position.
 * Sums the distance from `snapped` to the next vertex, then all subsequent segments.
 */
export function computeRemainingMeters(
  snapped: [number, number],
  segmentIndex: number,
  coords: [number, number][],
): number {
  if (coords.length === 0) return 0;
  // Distance from snapped position to end of current segment
  const next = coords[Math.min(segmentIndex + 1, coords.length - 1)];
  let remaining = haversineMeters(snapped, next);
  // Add all subsequent full segments
  for (let i = segmentIndex + 1; i < coords.length - 1; i++) {
    remaining += haversineMeters(coords[i], coords[i + 1]);
  }
  return remaining;
}
