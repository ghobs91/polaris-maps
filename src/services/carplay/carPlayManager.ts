/**
 * CarPlay manager — orchestrates the CarPlay integration by subscribing to
 * navigation and map stores and bridging state to the native CarPlay module.
 *
 * Handles:
 * - Syncing navigation state (maneuvers, ETA, distance) to CarPlay templates
 * - Forwarding CarPlay search queries to unifiedSearch and returning results
 * - Starting/stopping navigation from CarPlay search result selections
 * - Connecting/disconnecting lifecycle
 */

import { Platform } from 'react-native';
import * as CarPlay from '../../native/carplay';
import type { CarPlaySearchResult, CarPlayStartNavigationData } from '../../native/carplay';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMapStore } from '../../stores/mapStore';
import { buildCarPlayTrafficRanges, trafficRangesSignature } from './carPlayTrafficRanges';
import { unifiedSearch } from '../search/unifiedSearch';
import { computeRoute } from '../routing/routingService';
import type { EmitterSubscription } from 'react-native';

let initialized = false;
let connected = false;
let subscriptions: EmitterSubscription[] = [];
let navUnsubscribe: (() => void) | null = null;
let trackingUnsubscribe: (() => void) | null = null;
let trafficUnsubscribe: (() => void) | null = null;
let carPlayRouteKey: string | null = null;
let rerouteAlertShown = false;
let lastDistanceBucket: number | null = null;
let lastTrafficSignature = '';
let searchRequestId = 0;
let searchAbortController: AbortController | null = null;
let mapCenterUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMapCenter: { lat: number; lng: number; heading: number } | null = null;

/**
 * Initialise the CarPlay manager. Safe to call multiple times — subsequent
 * calls are no-ops. Call this once at app startup.
 */
export function initCarPlay(): void {
  if (initialized || Platform.OS !== 'ios' || !CarPlay.isAvailable || !CarPlay.emitter) return;
  initialized = true;

  subscriptions = [
    CarPlay.emitter.addListener('carPlayConnected', onConnected),
    CarPlay.emitter.addListener('carPlayDisconnected', onDisconnected),
    CarPlay.emitter.addListener('searchQuery', onSearchQuery),
    CarPlay.emitter.addListener('searchResultSelected', onSearchResultSelected),
  ];

  void CarPlay.isConnected()
    .then((isConnected) => {
      if (!initialized || connected || !isConnected) return;
      onConnected();
    })
    .catch(() => {});
}

/** Tear down all listeners. Primarily for tests. */
export function teardownCarPlay(): void {
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
  navUnsubscribe?.();
  navUnsubscribe = null;
  trackingUnsubscribe?.();
  trackingUnsubscribe = null;
  trafficUnsubscribe?.();
  trafficUnsubscribe = null;
  clearMapCenterUpdate();
  searchAbortController?.abort();
  searchAbortController = null;
  searchRequestId += 1;
  initialized = false;
  connected = false;
  carPlayRouteKey = null;
  rerouteAlertShown = false;
  lastDistanceBucket = null;
  lastTrafficSignature = '';
}

/** Whether CarPlay is currently connected. */
export function isCarPlayConnected(): boolean {
  return connected;
}

// ---------------------------------------------------------------------------
// Internal event handlers
// ---------------------------------------------------------------------------

function onConnected() {
  if (connected) return;

  connected = true;

  // Sync current navigation state whenever it changes
  navUnsubscribe?.();
  navUnsubscribe = useNavigationStore.subscribe(syncNavigationState);
  trackingUnsubscribe?.();
  trackingUnsubscribe = useNavigationTrackingStore.subscribe(onTrackingUpdate);
  trafficUnsubscribe?.();
  trafficUnsubscribe = useTrafficStore.subscribe(syncRouteTraffic);

  // If navigation is already active, push initial state
  syncNavigationState(useNavigationStore.getState());
}

function onDisconnected() {
  connected = false;
  navUnsubscribe?.();
  navUnsubscribe = null;
  trackingUnsubscribe?.();
  trackingUnsubscribe = null;
  trafficUnsubscribe?.();
  trafficUnsubscribe = null;
  clearMapCenterUpdate();
  searchAbortController?.abort();
  searchAbortController = null;
  searchRequestId += 1;
  carPlayRouteKey = null;
  rerouteAlertShown = false;
  lastDistanceBucket = null;
  lastTrafficSignature = '';
}

function syncNavigationState(state: ReturnType<typeof useNavigationStore.getState>) {
  if (!connected) return;

  if (!state.isNavigating || !state.activeRoute || !state.currentManeuver || !state.destination) {
    clearMapCenterUpdate();
    // Only tear down a session we actually started. This subscriber fires on
    // every store change, and repeating finishTrip while idle can flicker a
    // stale guidance card on some head units.
    if (carPlayRouteKey !== null) {
      CarPlay.updateNavigation({ isNavigating: false } as any);
      CarPlay.endNavigation();
      carPlayRouteKey = null;
    }
    lastDistanceBucket = null;
    lastTrafficSignature = '';
    hideRerouteAlert();
    return;
  }

  const routeKey = `${state.activeRoute.geometry}:${state.destination.lat}:${state.destination.lng}`;
  if (carPlayRouteKey !== routeKey) {
    CarPlay.startNavigation(toCarPlayNavigationData(state));
    carPlayRouteKey = routeKey;
    // Fresh route — re-evaluate traffic colors even if the store didn't change.
    lastTrafficSignature = '';
    syncRouteTraffic();
  }

  const allManeuvers = state.activeRoute.legs.flatMap((l) => l.maneuvers);
  const nextManeuver = allManeuvers[state.currentStepIndex + 1];
  const tracking = useNavigationTrackingStore.getState();
  const maneuver = state.currentManeuver;
  const rerouting = state.isRerouting || state.hasDeviated;
  syncRerouteAlert(rerouting);
  const liveDistance = tracking.distanceToTurn ?? maneuver.distanceMeters;
  lastDistanceBucket = distanceBucket(liveDistance);

  CarPlay.updateNavigation({
    isNavigating: true,
    instruction: maneuver.instruction,
    displayInstruction: maneuver.verbalPreTransition || maneuver.instruction,
    maneuverType: maneuver.type,
    // Live countdown from the tracking pipeline (like the phone banner),
    // falling back to the static route value before the first GPS fix.
    distanceToTurnMeters: liveDistance,
    durationToTurnSeconds: maneuver.durationSeconds,
    etaSeconds: state.trafficEtaSeconds ?? state.etaSeconds ?? 0,
    remainingDistanceMeters: state.remainingDistanceMeters ?? 0,
    nextInstruction: nextManeuver?.instruction,
    nextManeuverType: nextManeuver?.type,
    nextDistanceMeters: nextManeuver?.distanceMeters,
    nextDurationSeconds: nextManeuver?.durationSeconds,
    nextStreetNames: nextManeuver?.streetNames,
    ...toCarPlaySpeedLimit(maneuver.speedLimitMph),
    laneGuidance: maneuver.laneGuidance
      ? {
          laneCount: maneuver.laneGuidance.laneCount,
          activeLanes: maneuver.laneGuidance.activeLanes,
          laneDirections: maneuver.laneGuidance.laneDirections,
        }
      : undefined,
    isRerouting: rerouting,
  });
  syncMapCenter(tracking);
}

/** Shows/dismisses the native "Rerouting" alert only on transitions. */
function syncRerouteAlert(rerouting: boolean): void {
  if (rerouting === rerouteAlertShown) return;
  rerouteAlertShown = rerouting;
  if (rerouting) {
    CarPlay.showReroutingAlert();
  } else {
    CarPlay.hideNavigationAlert();
  }
}

function hideRerouteAlert(): void {
  if (!rerouteAlertShown) return;
  rerouteAlertShown = false;
  CarPlay.hideNavigationAlert();
}

/**
 * Posted speed limit for the CarPlay sign, converted to the user's unit
 * preference exactly like the phone's `SpeedLimitSign`.
 */
export function toCarPlaySpeedLimit(speedLimitMph: number | undefined): {
  speedLimitValue?: number;
  speedLimitUnit?: 'mph' | 'km/h';
} {
  if (speedLimitMph == null) return {};
  const useMetric = useSettingsStore.getState().useMetric;
  return {
    speedLimitValue: useMetric ? Math.round(speedLimitMph * 1.60934) : speedLimitMph,
    speedLimitUnit: useMetric ? 'km/h' : 'mph',
  };
}

/**
 * Pushes traffic-colored route ranges to the native map. Runs on traffic
 * store updates and route starts only — never on the hot position path —
 * and no-ops unless the colors actually changed.
 */
function syncRouteTraffic(): void {
  if (!connected || carPlayRouteKey === null) return;
  const nav = useNavigationStore.getState();
  if (!nav.isNavigating || !nav.activeRoute) return;
  const ranges = buildCarPlayTrafficRanges(
    nav.activeRoute.geometry,
    useTrafficStore.getState().normalizedSegments,
  );
  const signature = trafficRangesSignature(ranges);
  if (signature === lastTrafficSignature) return;
  lastTrafficSignature = signature;
  CarPlay.updateRouteTraffic(ranges ?? []);
}

/**
 * Tracking-pipeline subscriber: moves the map camera and re-pushes the
 * maneuver panel when the live countdown crosses a distance bucket. The
 * native side applies those re-pushes as in-place estimate updates (no card
 * rebuild), so the CarPlay banner counts down just like the phone banner.
 */
function onTrackingUpdate(state: ReturnType<typeof useNavigationTrackingStore.getState>) {
  syncMapCenter(state);
  if (!connected) return;
  const nav = useNavigationStore.getState();
  if (!nav.isNavigating || !nav.currentManeuver) return;
  const live = state.distanceToTurn ?? nav.currentManeuver.distanceMeters;
  const bucket = distanceBucket(live);
  if (bucket === lastDistanceBucket) return;
  syncNavigationState(nav);
}

/** Coarse buckets keep countdown pushes near ~1 Hz at city speeds. */
function distanceBucket(meters: number): number {
  if (meters < 100) return Math.round(meters / 5) * 5;
  if (meters < 500) return Math.round(meters / 10) * 10;
  return Math.round(meters / 25) * 25;
}

function syncMapCenter(state: ReturnType<typeof useNavigationTrackingStore.getState>) {
  if (!connected || !useNavigationStore.getState().isNavigating || !state.navPosition) return;

  pendingMapCenter = {
    lat: state.navPosition[1],
    lng: state.navPosition[0],
    heading: state.navBearing,
  };
  if (mapCenterUpdateTimer !== null) return;

  mapCenterUpdateTimer = setTimeout(() => {
    mapCenterUpdateTimer = null;
    const center = pendingMapCenter;
    pendingMapCenter = null;
    if (!center || !connected || !useNavigationStore.getState().isNavigating) return;
    CarPlay.updateMapCenter(center.lat, center.lng, center.heading);
  }, 100);
}

function clearMapCenterUpdate() {
  if (mapCenterUpdateTimer !== null) {
    clearTimeout(mapCenterUpdateTimer);
    mapCenterUpdateTimer = null;
  }
  pendingMapCenter = null;
}

async function onSearchQuery({ query }: { query: string }) {
  if (!connected) return;

  const requestId = ++searchRequestId;
  searchAbortController?.abort();
  const controller = new AbortController();
  searchAbortController = controller;
  const { viewport } = useMapStore.getState();
  try {
    const results = await unifiedSearch(query, {
      lat: viewport.lat,
      lng: viewport.lng,
      zoom: viewport.zoom,
      signal: controller.signal,
    });

    if (requestId !== searchRequestId || controller.signal.aborted || !connected) return;

    const carPlayResults: CarPlaySearchResult[] = results.slice(0, 12).map((r) => ({
      name: r.name,
      subtitle: r.subtitle,
      lat: r.lat,
      lng: r.lng,
    }));

    CarPlay.pushSearchResults(carPlayResults);
  } catch {
    if (requestId === searchRequestId && !controller.signal.aborted && connected) {
      CarPlay.pushSearchResults([]);
    }
  }
}

async function onSearchResultSelected(result: { name?: string; lat?: number; lng?: number }) {
  if (!connected) return;

  const lat = result.lat;
  const lng = result.lng;
  const name = result.name ?? 'Destination';
  if (lat == null || lng == null) return;

  // Get current location from map viewport as origin
  const { viewport } = useMapStore.getState();

  try {
    const routes = await computeRoute(
      [
        { lat: viewport.lat, lng: viewport.lng },
        { lat, lng },
      ],
      'auto',
    );

    const route = routes[0];
    if (!route) return;

    // Start navigation in the phone-side store. The store subscription above
    // creates the CarPlay session and keeps it in sync for every entry point.
    useNavigationStore.getState().startNavigation(route, [], { lat, lng, name }, 'auto');
  } catch {
    // Route computation failed — silently ignore on CarPlay
  }
}

function toCarPlayNavigationData(
  state: ReturnType<typeof useNavigationStore.getState>,
): CarPlayStartNavigationData {
  const route = state.activeRoute!;
  const destination = state.destination!;

  return {
    destinationName: destination.name ?? 'Destination',
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    encodedPolyline: route.geometry,
    maneuvers: route.legs.flatMap((leg) =>
      leg.maneuvers.map((maneuver) => ({
        instruction: maneuver.instruction,
        maneuverType: maneuver.type,
        distanceMeters: maneuver.distanceMeters,
        durationSeconds: maneuver.durationSeconds,
      })),
    ),
  };
}
