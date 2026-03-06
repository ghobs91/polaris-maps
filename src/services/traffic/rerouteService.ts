import { reroute, updateTrafficSpeeds } from '../routing/routingService';
import { getTrafficSpeedMap, getAllTrafficStates } from './trafficAggregator';
import { useNavigationStore } from '../../stores/navigationStore';
import type { CongestionLevel } from '../../models/traffic';

const CONGESTION_CHECK_INTERVAL_MS = 30_000;
const SIGNIFICANT_DELAY_FACTOR = 1.25; // 25% slower than expected

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function startRerouteMonitor(): void {
  if (checkInterval) return;
  checkInterval = setInterval(checkForReroute, CONGESTION_CHECK_INTERVAL_MS);
}

export function stopRerouteMonitor(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

async function checkForReroute(): Promise<void> {
  const navState = useNavigationStore.getState();
  if (!navState.isNavigating || !navState.activeRoute || !navState.destination) return;

  // Push latest traffic data to Valhalla
  const speedMap = getTrafficSpeedMap();
  if (Object.keys(speedMap).length > 0) {
    await updateTrafficSpeeds(speedMap);
  }

  // Check if route has significant congestion ahead
  if (hasSignificantCongestionAhead()) {
    try {
      navState.setRerouting(true);
      // Get current position from the route geometry step
      const route = navState.activeRoute;
      const dest = navState.destination;

      const newRoute = await reroute(
        { lat: 0, lng: 0, bearing: 0 }, // Would need actual GPS position
        { lat: dest.lat, lng: dest.lng },
        navState.costing,
      );

      // Only replace if new route is significantly better
      if (
        newRoute.summary.durationSeconds <
        route.summary.durationSeconds * SIGNIFICANT_DELAY_FACTOR
      ) {
        navState.replaceRoute(newRoute);
      } else {
        navState.setRerouting(false);
      }
    } catch {
      navState.setRerouting(false);
    }
  }
}

function hasSignificantCongestionAhead(): boolean {
  const states = getAllTrafficStates();
  const congestedSegments = states.filter(
    (s) => s.congestionLevel === 'congested' || s.congestionLevel === 'stopped',
  );
  // If more than 3 segments in the viewport are congested, consider rerouting
  return congestedSegments.length > 3;
}

export function getCongestionSummary(): {
  total: number;
  byCongestion: Record<CongestionLevel, number>;
} {
  const states = getAllTrafficStates();
  const byCongestion: Record<CongestionLevel, number> = {
    free_flow: 0,
    slow: 0,
    congested: 0,
    stopped: 0,
  };
  for (const s of states) {
    byCongestion[s.congestionLevel]++;
  }
  return { total: states.length, byCongestion };
}
