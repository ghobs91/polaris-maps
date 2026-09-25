/**
 * Fix-driven freshness for background navigation.
 *
 * iOS suspends JS timers (`setInterval`) when the phone is locked/screen-off,
 * so the periodic traffic refresh and the congestion-reroute monitor never
 * fire while the driver is locked out of the app: ETA/traffic colours go stale
 * and congestion reroutes never run. Location fixes keep arriving via the
 * headless background task, so we piggyback a throttled refresh on each fix
 * instead — the same pattern CarPlay uses for its map-centre push.
 *
 * Foreground is left to the mounted screen's `useNavigationTrafficRefresh`
 * hook; this only acts while the app is not active.
 *
 * Call once during app startup (root layout).
 */

import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { decodePolyline } from '../../utils/polyline';
import { refreshRouteTrafficIfStale } from '../traffic/trafficFlowService';
import { runCongestionCheckIfDue } from '../traffic/rerouteService';
import { isForegroundInterpolationActive } from './foregroundActivity';

let initialized = false;
let navUnsubscribe: (() => void) | null = null;
let trackingUnsubscribe: (() => void) | null = null;
/** Decoded geometry of the route currently being refreshed. */
let routeCoords: [number, number][] | null = null;

function syncRouteCoords(): void {
  const nav = useNavigationStore.getState();
  if (!nav.isNavigating || !nav.activeRoute) {
    routeCoords = null;
    return;
  }
  const coords = decodePolyline(nav.activeRoute.geometry);
  routeCoords = coords.length >= 2 ? coords : null;
}

function onTrackingUpdate(): void {
  // A ticking interpolation loop means the phone display is awake and the
  // screen hook's interval is covering freshness. It also stops when the
  // display sleeps while CarPlay keeps the app active, where `AppState` stays
  // `active` and the interval never fires — so gate on the loop, not AppState.
  if (isForegroundInterpolationActive()) return;
  const coords = routeCoords;
  if (!coords) return;
  refreshRouteTrafficIfStale(coords);
  runCongestionCheckIfDue();
}

export function initFixDrivenRefresh(): void {
  if (initialized) return;
  initialized = true;
  syncRouteCoords();
  navUnsubscribe = useNavigationStore.subscribe(syncRouteCoords);
  trackingUnsubscribe = useNavigationTrackingStore.subscribe(onTrackingUpdate);
}

/** Stop listening. Primarily for tests. */
export function teardownFixDrivenRefresh(): void {
  navUnsubscribe?.();
  trackingUnsubscribe?.();
  navUnsubscribe = null;
  trackingUnsubscribe = null;
  initialized = false;
  routeCoords = null;
}
