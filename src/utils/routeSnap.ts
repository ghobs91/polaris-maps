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

/** Smallest angular difference between two bearings in degrees (0–180). */
export function angleDifferenceDeg(a: number, b: number): number {
  return Math.abs((((a - b + 540) % 360) - 180) % 360);
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

/** Snap result: the projected point, its bearing, segment index and offset. */
export interface RouteSnapResult {
  snapped: [number, number];
  bearing: number;
  segmentIndex: number;
  distanceMeters: number;
}

export interface SnapToRouteOptions {
  /**
   * Segment index of the previous fix. When provided, the snap is constrained
   * to a window of the route around this index so a fix near a self-approaching
   * section (cloverleaf, parallel carriageway, out-and-back) cannot teleport
   * the puck to a distant part of the route.
   */
  hintIndex?: number;
  /** Route distance (m) ahead of the hint still eligible for snapping. */
  maxAheadMeters?: number;
  /** Route distance (m) behind the hint still eligible for snapping. */
  maxBehindMeters?: number;
}

/** Continuity window defaults — generous for 1 Hz fixes (≤ ~55 m/fix). */
const SNAP_MAX_AHEAD_METERS = 500;
const SNAP_MAX_BEHIND_METERS = 250;

interface SnapCandidate {
  dist: number;
  point: [number, number];
  idx: number;
}

/** Nearest projection of `pos` onto the given segments (all when `indices` is null). */
function nearestOnSegments(
  pos: [number, number],
  coords: [number, number][],
  indices: Set<number> | null,
): SnapCandidate {
  let best: SnapCandidate = { dist: Infinity, point: pos, idx: 0 };

  for (let i = 0; i < coords.length - 1; i++) {
    if (indices && !indices.has(i)) continue;
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
    if (dist < best.dist) {
      best = { dist, point: proj, idx: i };
    }
  }

  return best;
}

function toSnapResult(candidate: SnapCandidate, coords: [number, number][]): RouteSnapResult {
  const idx = candidate.idx;
  return {
    snapped: candidate.point,
    bearing: computeBearing(coords[idx], coords[Math.min(idx + 1, coords.length - 1)]),
    segmentIndex: idx,
    distanceMeters: candidate.dist === Infinity ? 0 : candidate.dist,
  };
}

/**
 * Snap a GPS coordinate to the nearest point on the route polyline.
 * Returns the snapped [lng, lat], bearing, the shape index of the segment,
 * and the distance in meters from the original position to the snapped point.
 *
 * When `options.hintIndex` is supplied, snapping is constrained to a window of
 * the route around that index: if the fix lies plausibly on-route within the
 * window it snaps there, otherwise (the user genuinely moved beyond the window
 * or is off-route) it falls back to the globally nearest segment.
 */
export function snapToRoute(
  pos: [number, number],
  coords: [number, number][],
  options?: SnapToRouteOptions,
): RouteSnapResult {
  const global = nearestOnSegments(pos, coords, null);
  if (options?.hintIndex == null || coords.length < 2) return toSnapResult(global, coords);

  const hint = Math.max(0, Math.min(options.hintIndex, coords.length - 2));
  const maxAhead = options.maxAheadMeters ?? SNAP_MAX_AHEAD_METERS;
  const maxBehind = options.maxBehindMeters ?? SNAP_MAX_BEHIND_METERS;

  // Build the eligible segment window by walking route distance from the hint.
  const window = new Set<number>();
  let acc = 0;
  for (let i = hint; i >= 0; i--) {
    window.add(i);
    acc += haversineMeters(coords[i], coords[Math.min(i + 1, coords.length - 1)]);
    if (acc > maxBehind) break;
  }
  acc = 0;
  for (let i = hint; i < coords.length - 1; i++) {
    window.add(i);
    acc += haversineMeters(coords[i], coords[i + 1]);
    if (acc > maxAhead) break;
  }

  const windowed = nearestOnSegments(pos, coords, window);
  // A windowed snap within the off-route threshold means the fix is on the
  // route near the hint — prefer it over a globally-nearest far segment.
  if (windowed.dist <= OFF_ROUTE_THRESHOLD_METERS) return toSnapResult(windowed, coords);
  return toSnapResult(global, coords);
}

/** Threshold in meters beyond which the user is considered off-route. */
export const OFF_ROUTE_THRESHOLD_METERS = 50;

/**
 * Worst GPS accuracy (meters) still trusted as off-route evidence. A position
 * whose own error circle is bigger than this cannot prove the user left the
 * route, so such fixes are ignored for deviation counting.
 */
export const OFF_ROUTE_MAX_ACCURACY_METERS = 30;

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
