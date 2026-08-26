import * as Haptics from 'expo-haptics';
import type { LocationObject } from 'expo-location';
import type { ValhallaManeuver, ValhallaRoute } from '../../models/route';
import { decodePolyline } from '../../utils/polyline';
import {
  snapToRoute,
  computeRemainingMeters,
  haversineMeters,
  isOffRoute,
  OFF_ROUTE_THRESHOLD_METERS,
} from '../../utils/routeSnap';
import { reroute } from '../routing/routingService';
import { useNavigationStore } from '../../stores/navigationStore';

/**
 * Dead-reckoning anchor: updated on every GPS fix.
 * pos/segIdx = snapped position on route; speedMps = estimated travel speed;
 * time = timestamp when this anchor was set.
 */
export interface DrAnchor {
  pos: [number, number];
  segIdx: number;
  speedMps: number;
  time: number;
}

let coords: [number, number][] = [];
let allManeuvers: ValhallaManeuver[] = [];
let activeRouteSummaryDistanceMeters = 0;
let activeRouteSummaryDurationSeconds = 0;
let trackingActive = false;

// Dead-reckoning anchor state (moved from NavigationScreen refs so headless
// background location tasks can drive the same pipeline).
let drAnchor: DrAnchor | null = null;
let gpsSegmentIndex = 0;
// Counter for consecutive off-route GPS readings; triggers reroute after threshold.
let offRouteCount = 0;
// Prevents overlapping reroute requests.
let reroutingFix = false;

/**
 * Begin tracking `route`. Decodes the polyline, builds the maneuver list and
 * resets all per-route state. Safe to call again on reroutes (replaces state).
 */
export function startTracking(route: ValhallaRoute): void {
  coords = decodePolyline(route.geometry);
  allManeuvers = route.legs.flatMap((l) => l.maneuvers);
  activeRouteSummaryDistanceMeters = route.summary.distanceMeters;
  activeRouteSummaryDurationSeconds = route.summary.durationSeconds;
  trackingActive = true;
}

/** Clear all tracking state. Called when navigation ends. */
export function stopTracking(): void {
  trackingActive = false;
  coords = [];
  allManeuvers = [];
  activeRouteSummaryDistanceMeters = 0;
  activeRouteSummaryDurationSeconds = 0;
  drAnchor = null;
  gpsSegmentIndex = 0;
  offRouteCount = 0;
  reroutingFix = false;
}

export function isTracking(): boolean {
  return trackingActive;
}

/** Current dead-reckoning anchor, or null before the first fix arrives. */
export function getAnchor(): Readonly<DrAnchor> | null {
  return drAnchor;
}

/** GPS-confirmed segment index, updated on every processed fix. */
export function getGpsSegmentIndex(): number {
  return gpsSegmentIndex;
}

/** Decoded polyline of the route being tracked ([] when not tracking). */
export function getRouteCoords(): ReadonlyArray<[number, number]> {
  return coords;
}

/**
 * Walk `distMeters` forward along the tracked route polyline from
 * startPos/startSegIdx. Returns the projected [lng, lat] and the segment
 * index it falls on.
 */
export function advanceAlongRoute(
  startPos: [number, number],
  startSegIdx: number,
  distMeters: number,
): [[number, number], number] {
  let remaining = distMeters;
  let pos = startPos;
  let segIdx = startSegIdx;
  while (remaining > 0 && segIdx < coords.length - 1) {
    const segEnd = coords[segIdx + 1];
    const distToEnd = haversineMeters(pos, segEnd);
    if (distToEnd <= remaining) {
      remaining -= distToEnd;
      pos = segEnd;
      segIdx++;
    } else {
      const t = remaining / distToEnd;
      pos = [pos[0] + (segEnd[0] - pos[0]) * t, pos[1] + (segEnd[1] - pos[1]) * t];
      remaining = 0;
    }
  }
  return [pos, segIdx];
}

// Distance from pos/segIdx to coords[targetIdx], walking the polyline.
export function distToIndex(pos: [number, number], segIdx: number, targetIdx: number): number {
  if (segIdx >= targetIdx) return 0;
  let d = haversineMeters(pos, coords[segIdx + 1]);
  for (let i = segIdx + 1; i < targetIdx; i++) d += haversineMeters(coords[i], coords[i + 1]);
  return d;
}

/**
 * Process one GPS fix through the full turn-by-turn pipeline:
 * snap-to-route, off-route detection & rerouting, dead-reckoning anchor
 * update (with the no-backwards-jump rule), ETA update, and maneuver step
 * advancement. Identical whether invoked foreground or background.
 */
export function processFix(location: LocationObject): void {
  if (!trackingActive || coords.length < 2) return;

  const gpsPos: [number, number] = [location.coords.longitude, location.coords.latitude];
  const { snapped, segmentIndex, distanceMeters: distFromRoute } = snapToRoute(gpsPos, coords);
  gpsSegmentIndex = segmentIndex;
  const now = performance.now();

  // --- Off-route detection & rerouting ---
  if (distFromRoute > OFF_ROUTE_THRESHOLD_METERS) {
    offRouteCount++;
  } else {
    offRouteCount = 0;
  }

  const store = useNavigationStore.getState();

  if (isOffRoute(distFromRoute, offRouteCount) && !reroutingFix && store.destination) {
    reroutingFix = true;
    store.setDeviated(true);
    store.setRerouting(true);

    const gpsBearing = location.coords.heading ?? 0;
    reroute(
      {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        bearing: gpsBearing,
      },
      { lat: store.destination.lat, lng: store.destination.lng },
      store.costing,
    )
      .then((newRoute) => {
        const navStore = useNavigationStore.getState();
        if (navStore.isNavigating) {
          navStore.replaceRoute(newRoute);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          // Reset DR anchor and GPS segment index to start of the new route.
          // The next GPS callback will correct the segment index to the
          // actual position; using 0 here prevents stale indices from the
          // previous route causing premature step advances.
          const newCoords = decodePolyline(newRoute.geometry);
          if (newCoords.length >= 2) {
            // Adopt the new route into this tracker without resetting
            // bookkeeping the caller may still rely on.
            coords = newCoords;
            allManeuvers = newRoute.legs.flatMap((l) => l.maneuvers);
            activeRouteSummaryDistanceMeters = newRoute.summary.distanceMeters;
            activeRouteSummaryDurationSeconds = newRoute.summary.durationSeconds;
            drAnchor = {
              pos: newCoords[0],
              segIdx: 0,
              speedMps: (location.coords.speed ?? -1) >= 0 ? location.coords.speed! : 0,
              time: now,
            };
            gpsSegmentIndex = 0;
          }
        }
        offRouteCount = 0;
        reroutingFix = false;
      })
      .catch(() => {
        // Reroute failed (e.g., no connectivity) — clear rerouting flag
        // so it will retry on the next off-route GPS reading.
        useNavigationStore.getState().setRerouting(false);
        reroutingFix = false;
      });

    return; // Skip normal DR update while rerouting
  }

  // Prefer the GPS speed field; fall back to estimating from distance/time delta.
  let speedMps = (location.coords.speed ?? -1) >= 0 ? location.coords.speed! : 0;
  if (speedMps <= 0 && drAnchor) {
    const dt = (now - drAnchor.time) / 1000;
    if (dt > 0.1) {
      speedMps = haversineMeters(drAnchor.pos, snapped) / dt;
    }
  }
  // Clamp to reasonable road speed (0–55 m/s ≈ 200 km/h)
  speedMps = Math.min(Math.max(speedMps, 0), 55);

  // Never move the marker backwards. If the current dead-reckoning
  // projection is *ahead* of the GPS snapped position on the route,
  // keep the DR position as the new anchor and simply adopt the
  // GPS speed. This prevents the visible backward jump that occurs
  // when GPS latency/inaccuracy reports a position behind the smooth
  // extrapolation.
  const prevAnchor = drAnchor;
  if (prevAnchor && prevAnchor.speedMps > 0.3) {
    const elapsed = Math.min((now - prevAnchor.time) / 1000, 2.0);
    const [drPos, drSegIdx] = advanceAlongRoute(
      prevAnchor.pos,
      prevAnchor.segIdx,
      prevAnchor.speedMps * elapsed,
    );
    const drRemaining = computeRemainingMeters(drPos, drSegIdx, coords);
    const gpsRemaining = computeRemainingMeters(snapped, segmentIndex, coords);
    if (drRemaining < gpsRemaining) {
      // DR is ahead of GPS — anchor at DR position, update speed only
      drAnchor = { pos: drPos, segIdx: drSegIdx, speedMps, time: now };
    } else {
      drAnchor = { pos: snapped, segIdx: segmentIndex, speedMps, time: now };
    }
  } else {
    drAnchor = { pos: snapped, segIdx: segmentIndex, speedMps, time: now };
  }

  // Update remaining distance and ETA based on current GPS position
  const remainingMeters = computeRemainingMeters(snapped, segmentIndex, coords);
  const progress =
    activeRouteSummaryDistanceMeters > 0 ? remainingMeters / activeRouteSummaryDistanceMeters : 0;
  store.updateEta(Math.round(progress * activeRouteSummaryDurationSeconds), remainingMeters);

  // Advance maneuver step if user has progressed past the next step's start shape index
  const nextStep = store.currentStepIndex + 1;
  if (nextStep < allManeuvers.length && segmentIndex >= allManeuvers[nextStep].beginShapeIndex) {
    store.advanceStep();
  }
}
