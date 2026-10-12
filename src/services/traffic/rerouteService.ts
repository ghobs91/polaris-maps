import { rerouteCandidates, updateTrafficSpeeds } from '../routing/routingService';
import { getRouteCoords } from '../navigation/trackingService';
import { getTrafficSpeedMap } from './trafficAggregator';
import { evaluateCongestionAhead, type TrafficObservation } from './congestionAhead';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { extractRouteSegments, calculateTrafficETA } from '../../utils/etaCalculator';
import type { ValhallaRoute } from '../../models/route';
import type { NormalizedTrafficSegment } from '../../models/traffic';
import {
  CONGESTION_CHECK_INTERVAL_MS,
  FULL_ROUTE_COMPARE_INTERVAL_MS,
  SUGGESTION_TIMEOUT_MS,
  isSignificantlyFasterRoute,
} from './reroutePolicy';
import {
  isSuggestionCoolingDown,
  noteFasterRouteDismissed,
  resetSuggestionCooldown,
} from './rerouteCooldown';

export { noteFasterRouteDismissed } from './rerouteCooldown';

let checkInterval: ReturnType<typeof setInterval> | null = null;
/** Wall-clock of the last monitor tick. */
let lastCheckAt = 0;
/** Wall-clock of the last candidate comparison. */
let lastCompareAt = 0;
/** Single-flight guard so overlapping comparisons cannot pile up. */
let evaluating = false;
/** Auto-expiry timer for the on-screen suggestion. */
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;

export function startRerouteMonitor(): void {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    runCongestionCheckIfDue();
  }, CONGESTION_CHECK_INTERVAL_MS);
}

/**
 * Decide whether to run a faster-route comparison.
 *
 * Congestion ahead on the active route triggers one immediately; otherwise a
 * comparison runs on the slower full-compare interval so a user who deviated
 * onto a heavier road is still evaluated even without congestion ahead.
 *
 * The foreground monitor uses `setInterval`, which iOS suspends while the
 * phone is locked; background navigation calls this on each location fix
 * instead (see `fixDrivenRefresh`). Shares `lastCheckAt` with the monitor so
 * the two never overlap.
 */
export function runCongestionCheckIfDue(now: number = Date.now()): void {
  if (now - lastCheckAt < CONGESTION_CHECK_INTERVAL_MS) return;
  lastCheckAt = now;

  const navState = useNavigationStore.getState();
  if (!navState.isNavigating || !navState.activeRoute || !navState.destination) return;

  const position = useNavigationTrackingStore.getState().navPosition;
  if (!position) return; // no GPS fix yet — defer

  const congested = evaluateCongestionAhead(
    getRouteCoords(),
    position,
    collectTrafficObservations(),
  ).hasSignificantCongestion;

  const compareDue = now - lastCompareAt >= FULL_ROUTE_COMPARE_INTERVAL_MS;
  if (!congested && !compareDue) return;

  lastCompareAt = now;
  void evaluateFasterRoute();
}

export function stopRerouteMonitor(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  clearSuggestionTimer();
  lastCheckAt = 0;
  lastCompareAt = 0;
  resetSuggestionCooldown();
  evaluating = false;
}

function clearSuggestionTimer(): void {
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
    suggestionTimer = null;
  }
}

/**
 * Auto-dismiss the suggestion after `SUGGESTION_TIMEOUT_MS` and start the
 * cooldown, so an ignored prompt does not linger. No-ops when the user has
 * already accepted or dismissed it (the store no longer holds this route).
 */
function scheduleSuggestionExpiry(route: ValhallaRoute): void {
  clearSuggestionTimer();
  suggestionTimer = setTimeout(() => {
    suggestionTimer = null;
    const current = useNavigationStore.getState();
    if (current.fasterRouteSuggestion?.route === route) {
      current.dismissFasterRoute();
      noteFasterRouteDismissed();
    }
  }, SUGGESTION_TIMEOUT_MS);
}

function collectTrafficObservations(): TrafficObservation[] {
  const observations: TrafficObservation[] = [];
  for (const segment of useTrafficStore.getState().normalizedSegments) {
    const position = segment.coordinates[0];
    if (!position) continue;
    observations.push({
      position: [position[0], position[1]],
      congestionRatio: segment.congestionRatio,
    });
  }
  return observations;
}

/**
 * The current route's remaining travel time, traffic-adjusted when available.
 * `trafficEtaSeconds` is the whole active route under live traffic, so it is
 * scaled by the remaining distance fraction; otherwise the tracking service's
 * remaining ETA is used.
 */
function remainingTrafficAdjustedSeconds(
  navState: ReturnType<typeof useNavigationStore.getState>,
  activeRoute: ValhallaRoute,
): number {
  const totalDistance = activeRoute.summary.distanceMeters;
  const remainingDistance = navState.remainingDistanceMeters;
  const fraction =
    totalDistance > 0 && remainingDistance != null
      ? Math.min(1, Math.max(0, remainingDistance / totalDistance))
      : 1;

  if (navState.trafficEtaSeconds != null && navState.trafficEtaSeconds > 0) {
    return navState.trafficEtaSeconds * fraction;
  }
  return navState.etaSeconds ?? activeRoute.summary.durationSeconds;
}

/**
 * Score a candidate's duration with the same traffic model used for the
 * current route. Falls back to the engine duration when coverage is too sparse
 * for the adjusted value to be trustworthy.
 */
function trafficAdjustedDurationSeconds(
  route: ValhallaRoute,
  traffic: NormalizedTrafficSegment[],
): number {
  if (traffic.length === 0) return route.summary.durationSeconds;

  const maneuvers = route.legs.flatMap((l) => l.maneuvers);
  const segments = extractRouteSegments(route.geometry, undefined, maneuvers);
  if (segments.length === 0) return route.summary.durationSeconds;

  const result = calculateTrafficETA(segments, traffic);
  const matchRatio = result.segmentCount > 0 ? result.matchedSegmentCount / result.segmentCount : 0;
  // Below ~10% matched, the free-flow estimate is noisier than the engine's.
  return matchRatio > 0.1 && result.totalSeconds > 0
    ? result.totalSeconds
    : route.summary.durationSeconds;
}

/**
 * Compare traffic-aware candidates from the current position against the active
 * route's remaining time and, if one is significantly faster, surface a
 * suggestion. The active route is never replaced here — the user decides.
 */
async function evaluateFasterRoute(): Promise<void> {
  if (evaluating) return;

  const navState = useNavigationStore.getState();
  if (!navState.isNavigating || !navState.activeRoute || !navState.destination) return;
  if (navState.isRerouting) return; // deviation reroute in flight
  if (navState.fasterRouteSuggestion) return; // already offering a choice

  const tracking = useNavigationTrackingStore.getState();
  const position = tracking.navPosition;
  if (!position) return;

  if (isSuggestionCoolingDown()) return;

  const activeRoute = navState.activeRoute;
  const currentRemaining = remainingTrafficAdjustedSeconds(navState, activeRoute);
  if (currentRemaining <= 0) return;

  const prefs = useSettingsStore.getState().routePreferences;
  const remainingWaypoints = navState.waypoints
    .slice(navState.currentLegIndex)
    .map(({ lat, lng }) => ({ lat, lng }));

  // Push the latest P2P traffic speeds into the routing engine so the candidate
  // routes account for congestion as well as the comparison.
  const speedMap = getTrafficSpeedMap();
  if (Object.keys(speedMap).length > 0) {
    await updateTrafficSpeeds(speedMap);
  }

  evaluating = true;
  try {
    const candidates = await rerouteCandidates(
      { lat: position[1], lng: position[0], bearing: tracking.navBearing },
      { lat: navState.destination.lat, lng: navState.destination.lng },
      navState.costing,
      {
        heading: tracking.navBearing,
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        avoidFerries: prefs.avoidFerries,
        via: remainingWaypoints,
        alternates: 2,
      },
    );

    const traffic = useTrafficStore.getState().normalizedSegments;
    let best: { route: ValhallaRoute; duration: number } | null = null;
    for (const candidate of candidates) {
      const duration = trafficAdjustedDurationSeconds(candidate, traffic);
      if (!isSignificantlyFasterRoute(duration, currentRemaining)) continue;
      if (!best || duration < best.duration) best = { route: candidate, duration };
    }
    if (!best) return;

    // Navigation may have ended or a suggestion appeared while awaiting.
    const still = useNavigationStore.getState();
    if (!still.isNavigating || still.fasterRouteSuggestion) return;
    still.suggestFasterRoute(best.route, Math.round(currentRemaining - best.duration));
    scheduleSuggestionExpiry(best.route);
  } catch {
    // Best-effort: a failed comparison leaves the active route in place.
  } finally {
    evaluating = false;
  }
}
