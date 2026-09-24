import { reroute, updateTrafficSpeeds } from '../routing/routingService';
import { getRouteCoords } from '../navigation/trackingService';
import { getTrafficSpeedMap } from './trafficAggregator';
import { evaluateCongestionAhead, type TrafficObservation } from './congestionAhead';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrafficStore } from '../../stores/trafficStore';
import {
  CONGESTION_CHECK_INTERVAL_MS,
  isRerouteCoolingDown,
  isReplacementRouteAcceptable,
} from './reroutePolicy';

let checkInterval: ReturnType<typeof setInterval> | null = null;
let lastRerouteAt = 0;
/** Wall-clock of the last congestion check (see the fix-driven path). */
let lastCheckAt = 0;

export function startRerouteMonitor(): void {
  if (checkInterval) return;
  checkInterval = setInterval(() => {
    runCongestionCheckIfDue();
  }, CONGESTION_CHECK_INTERVAL_MS);
}

/**
 * Run the congestion check if the interval has elapsed.
 *
 * The foreground monitor uses `setInterval`, which iOS suspends while the
 * phone is locked; background navigation calls this on each location fix
 * instead (see `fixDrivenRefresh`). Shares `lastCheckAt` with the monitor so
 * the two never overlap.
 */
export function runCongestionCheckIfDue(now: number = Date.now()): void {
  if (now - lastCheckAt < CONGESTION_CHECK_INTERVAL_MS) return;
  lastCheckAt = now;
  void checkForReroute();
}

export function stopRerouteMonitor(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  lastRerouteAt = 0;
  lastCheckAt = 0;
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

async function checkForReroute(): Promise<void> {
  const navState = useNavigationStore.getState();
  if (!navState.isNavigating || !navState.activeRoute || !navState.destination) return;
  if (navState.isRerouting) return;

  const tracking = useNavigationTrackingStore.getState();
  const position = tracking.navPosition;
  if (!position) return; // no GPS fix yet — defer

  const routeCoords = getRouteCoords();
  const { hasSignificantCongestion } = evaluateCongestionAhead(
    routeCoords,
    position,
    collectTrafficObservations(),
  );
  if (!hasSignificantCongestion) return;
  if (isRerouteCoolingDown(Date.now(), lastRerouteAt)) return;

  const route = navState.activeRoute;
  const destination = navState.destination;
  const prefs = useSettingsStore.getState().routePreferences;
  const remainingWaypoints = navState.waypoints
    .slice(navState.currentLegIndex)
    .map(({ lat, lng }) => ({ lat, lng }));

  // Push the latest P2P traffic speeds into the routing engine so the new
  // route accounts for congestion as well as the reroute decision.
  const speedMap = getTrafficSpeedMap();
  if (Object.keys(speedMap).length > 0) {
    await updateTrafficSpeeds(speedMap);
  }

  navState.setRerouting(true);
  try {
    const newRoute = await reroute(
      { lat: position[1], lng: position[0], bearing: tracking.navBearing },
      { lat: destination.lat, lng: destination.lng },
      navState.costing,
      {
        heading: tracking.navBearing,
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        avoidFerries: prefs.avoidFerries,
        via: remainingWaypoints,
      },
    );

    if (
      isReplacementRouteAcceptable(newRoute.summary.durationSeconds, route.summary.durationSeconds)
    ) {
      lastRerouteAt = Date.now();
      navState.replaceRoute(newRoute);
    } else {
      navState.setRerouting(false);
    }
  } catch {
    navState.setRerouting(false);
  }
}
