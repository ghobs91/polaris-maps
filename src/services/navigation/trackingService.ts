import * as Haptics from 'expo-haptics';
import type { LocationObject } from 'expo-location';
import type { ValhallaManeuver, ValhallaRoute } from '../../models/route';
import { decodePolyline } from '../../utils/polyline';
import {
  snapToRoute,
  computeRemainingMeters,
  haversineMeters,
  angleDifferenceDeg,
  isOffRoute,
  OFF_ROUTE_THRESHOLD_METERS,
} from '../../utils/routeSnap';
import { reroute } from '../routing/routingService';
import { useNavigationStore } from '../../stores/navigationStore';

/** Avoidance preferences forwarded to the reroute request. Injected via
 *  `setTrackingRoutePreferences` (rather than importing the settings store)
 *  so this module stays free of native-module imports for headless use. */
export interface TrackingRoutePreferences {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
}

let reroutePrefs: TrackingRoutePreferences = {};

export function setTrackingRoutePreferences(prefs: TrackingRoutePreferences): void {
  reroutePrefs = { ...prefs };
}

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
// Wrong-way driving (user moving opposite the route direction while still
// snapped near the polyline, so distance-based off-route never fires).
let wrongWayCount = 0;
let wrongWayActive = false;
let lastGpsHeading: number | null = null;
let lastGpsSpeedMps = 0;
let lastGpsRemaining: number | null = null;

/** GPS course is only trusted above walking speed (m/s). */
export const WRONG_WAY_MIN_SPEED_MPS = 3;
/** Heading vs route-bearing mismatch that counts as opposite direction. */
export const WRONG_WAY_HEADING_THRESHOLD_DEG = 120;
/** Consecutive opposite-direction fixes required before rerouting. */
export const WRONG_WAY_CONSECUTIVE_COUNT = 3;
/** Remaining-distance growth (m) that counts as driving backwards when no heading. */
const WRONG_WAY_BACKWARD_GROWTH_METERS = 10;

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
  offRouteCount = 0;
  reroutingFix = false;
  wrongWayCount = 0;
  wrongWayActive = false;
  lastGpsHeading = null;
  lastGpsSpeedMps = 0;
  lastGpsRemaining = null;
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
  wrongWayCount = 0;
  wrongWayActive = false;
  lastGpsHeading = null;
  lastGpsSpeedMps = 0;
  lastGpsRemaining = null;
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

/** True while the user is driving opposite the route direction. */
export function isWrongWayDriving(): boolean {
  return wrongWayActive;
}

/** Last trusted GPS course in degrees, or null when unknown/slow. */
export function getGpsCourse(): number | null {
  return lastGpsHeading;
}

/** Last GPS speed in m/s (0 when unknown). */
export function getGpsSpeed(): number {
  return lastGpsSpeedMps;
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

export interface ProcessFixOptions {
  /**
   * True when invoked from the headless background location task. Network
   * reroutes and haptics are skipped — the fix is still snapped, the
   * dead-reckoning anchor still advances, and a deviation is flagged so the
   * foreground reroutes on return. Background tasks that perform network
   * I/O risk an iOS watchdog kill (reported as a crash).
   */
  background?: boolean;
}

/**
 * Process one GPS fix through the full turn-by-turn pipeline:
 * snap-to-route, off-route detection & rerouting, dead-reckoning anchor
 * update (with the no-backwards-jump rule), ETA update, and maneuver step
 * advancement. Identical whether invoked foreground or background, except
 * background invocations never trigger a network reroute or haptics.
 */
export function processFix(location: LocationObject, opts?: ProcessFixOptions): void {
  if (!trackingActive || coords.length < 2) return;
  const isBackground = opts?.background === true;

  const gpsPos: [number, number] = [location.coords.longitude, location.coords.latitude];
  const {
    snapped,
    segmentIndex,
    distanceMeters: distFromRoute,
    bearing: routeBearing,
  } = snapToRoute(gpsPos, coords);
  gpsSegmentIndex = segmentIndex;
  const now = performance.now();

  // --- Wrong-way detection (driving opposite the route while still near it) ---
  // Distance-based off-route never fires here: the snapped point stays close
  // to the polyline, so compare travel direction against the route bearing.
  const rawSpeed = location.coords.speed ?? -1;
  const rawHeading = location.coords.heading;
  const headingValid =
    rawHeading != null && Number.isFinite(rawHeading) && rawHeading >= 0 && rawHeading <= 360;
  const movingFast = rawSpeed >= WRONG_WAY_MIN_SPEED_MPS;
  lastGpsSpeedMps = rawSpeed >= 0 ? rawSpeed : 0;
  lastGpsHeading = movingFast && headingValid ? rawHeading! : null;
  const gpsRemainingNow = computeRemainingMeters(snapped, segmentIndex, coords);
  if (distFromRoute <= OFF_ROUTE_THRESHOLD_METERS && movingFast) {
    if (headingValid) {
      const headingDiff = angleDifferenceDeg(routeBearing, rawHeading!);
      if (headingDiff > WRONG_WAY_HEADING_THRESHOLD_DEG) {
        wrongWayCount++;
      } else {
        wrongWayCount = 0;
        if (headingDiff < 90) wrongWayActive = false;
      }
    } else {
      // No compass course — fall back to route progress: remaining distance
      // growing while moving means driving backwards along the route.
      if (lastGpsRemaining != null) {
        const growth = gpsRemainingNow - lastGpsRemaining;
        if (growth > WRONG_WAY_BACKWARD_GROWTH_METERS) {
          wrongWayCount++;
        } else if (growth < -WRONG_WAY_BACKWARD_GROWTH_METERS) {
          wrongWayCount = 0;
          wrongWayActive = false;
        }
      }
    }
    if (wrongWayCount >= WRONG_WAY_CONSECUTIVE_COUNT) wrongWayActive = true;
  } else if (distFromRoute > OFF_ROUTE_THRESHOLD_METERS) {
    // Truly off-route — heading comparison is meaningless until re-snapped.
    wrongWayCount = 0;
    wrongWayActive = false;
  }
  lastGpsRemaining = gpsRemainingNow;

  // --- Off-route detection & rerouting ---
  if (distFromRoute > OFF_ROUTE_THRESHOLD_METERS) {
    offRouteCount++;
  } else {
    offRouteCount = 0;
  }

  const store = useNavigationStore.getState();
  const needsReroute =
    isOffRoute(distFromRoute, offRouteCount) || wrongWayCount >= WRONG_WAY_CONSECUTIVE_COUNT;

  if (needsReroute && !reroutingFix && store.destination) {
    if (isBackground) {
      // Defer the reroute to the foreground: flag the deviation so the next
      // foreground fix reroutes immediately, but perform no network I/O or
      // haptics here. Fall through to the normal DR/ETA update below.
      store.setDeviated(true);
    } else {
      reroutingFix = true;
      store.setDeviated(true);
      store.setRerouting(true);

      const gpsBearing = location.coords.heading ?? 0;
      // Preserve the stops the user hasn't reached yet — rerouting to the
      // final destination only would silently drop them from the trip.
      const pending = store.waypoints.slice(store.currentLegIndex);
      reroute(
        {
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          bearing: gpsBearing,
        },
        { lat: store.destination.lat, lng: store.destination.lng },
        store.costing,
        {
          via: pending.length > 0 ? pending : undefined,
          avoidTolls: reroutePrefs.avoidTolls,
          avoidHighways: reroutePrefs.avoidHighways,
          avoidFerries: reroutePrefs.avoidFerries,
          // Only trust the compass course when moving — a stationary/fresh
          // GPS heading (or the 0 fallback) would bias the engine toward a
          // phantom direction and produce U-turn-heavy "weird" routes.
          heading: movingFast && headingValid ? rawHeading! : undefined,
        },
      )
        .then((newRoute) => {
          const navStore = useNavigationStore.getState();
          if (navStore.isNavigating) {
            navStore.replaceRoute(newRoute);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
          wrongWayCount = 0;
          wrongWayActive = false;
          lastGpsRemaining = null;
          reroutingFix = false;
        })
        .catch(() => {
          // Reroute failed (e.g., no connectivity) — clear rerouting flag
          // so it will retry on the next off-route GPS reading.
          // Keep wrongWayCount so a wrong-way drive retries immediately,
          // mirroring the off-route counter behaviour.
          useNavigationStore.getState().setRerouting(false);
          reroutingFix = false;
        });

      return; // Skip normal DR update while rerouting
    }
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

  // Never move the marker backwards — unless the user is driving the wrong
  // way. In that case the GPS-snapped position legitimately moves backwards
  // along the route, and holding the DR projection ahead is exactly what
  // makes the puck glide forward while the car reverses relative to it.
  const suspectedWrongWay = wrongWayCount > 0;
  const prevAnchor = drAnchor;
  if (prevAnchor && prevAnchor.speedMps > 0.3 && !suspectedWrongWay) {
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
