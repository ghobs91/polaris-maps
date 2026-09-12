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

import { Appearance, Platform } from 'react-native';
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
import { formatDistance } from '../../utils/units';
import { resolveMapStyle, setLayerVisibilityInStyle } from '../../components/map/mapStyleResolver';
import type { EmitterSubscription } from 'react-native';

let initialized = false;
let connected = false;
let subscriptions: EmitterSubscription[] = [];
let navUnsubscribe: (() => void) | null = null;
let trackingUnsubscribe: (() => void) | null = null;
let trafficUnsubscribe: (() => void) | null = null;
let settingsUnsubscribe: (() => void) | null = null;
let mapStyleUnsubscribe: (() => void) | null = null;
let appearanceSubscription: { remove: () => void } | null = null;
let lastMapStyleKey: string | null = null;
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
    CarPlay.emitter.addListener('searchResultAddStop', onSearchResultAddStop),
  ];
  appearanceSubscription?.remove();
  appearanceSubscription = Appearance.addChangeListener(syncMapStyle);

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
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  mapStyleUnsubscribe?.();
  mapStyleUnsubscribe = null;
  appearanceSubscription?.remove();
  appearanceSubscription = null;
  lastMapStyleKey = null;
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
  settingsUnsubscribe?.();
  settingsUnsubscribe = useSettingsStore.subscribe(syncMapStyle);
  mapStyleUnsubscribe?.();
  mapStyleUnsubscribe = useMapStore.subscribe(syncMapStyle);

  // Push the phone's current map style (dark/light, satellite) so the
  // CarPlay map matches the phone map.
  lastMapStyleKey = null;
  syncMapStyle();

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
  settingsUnsubscribe?.();
  settingsUnsubscribe = null;
  mapStyleUnsubscribe?.();
  mapStyleUnsubscribe = null;
  lastMapStyleKey = null;
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
    durationToTurnSeconds: liveDurationToTurnSeconds(maneuver, liveDistance),
    // Traffic-scaled remaining ETA, exactly like the phone's EtaDisplay.
    etaSeconds: selectCarPlayEtaSeconds(state),
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
 * Trip ETA for CarPlay, matching the phone's `EtaDisplay`: the TomTom
 * full-route traffic ETA scaled by the remaining-distance fraction so it
 * stays in sync with the chevron, falling back to the base route ETA.
 */
export function selectCarPlayEtaSeconds(
  state: Pick<
    ReturnType<typeof useNavigationStore.getState>,
    'activeRoute' | 'remainingDistanceMeters' | 'trafficEtaSeconds' | 'etaSeconds'
  >,
): number {
  const totalMeters = state.activeRoute?.summary.distanceMeters ?? 0;
  if (state.trafficEtaSeconds != null && state.activeRoute != null) {
    const remaining = state.remainingDistanceMeters ?? totalMeters;
    const progress = totalMeters > 0 ? remaining / totalMeters : 0;
    return Math.round(progress * state.trafficEtaSeconds);
  }
  return state.trafficEtaSeconds ?? state.etaSeconds ?? 0;
}

/**
 * Live time-to-turn for CarPlay: the static maneuver duration scaled by the
 * remaining fraction of the maneuver so the CarPlay card counts down like
 * the phone banner's distance countdown.
 */
export function liveDurationToTurnSeconds(
  maneuver: Pick<
    { distanceMeters: number; durationSeconds: number },
    'distanceMeters' | 'durationSeconds'
  >,
  liveDistanceMeters: number,
): number {
  if (maneuver.distanceMeters <= 0) return maneuver.durationSeconds;
  return (maneuver.durationSeconds * Math.max(liveDistanceMeters, 0)) / maneuver.distanceMeters;
}

/** Route-preview duration format, mirroring the phone's FloatingSearchPanel. */
function formatPreviewDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Route-choice summary for CarPlay ("26 min · 13.8 mi"), mirroring the
 * phone's route-preview header: duration first, then `formatDistance` so
 * units always match the phone (imperial/metric via device locale).
 */
export function formatCarPlayRouteSummary(distanceMeters: number, durationSeconds: number): string {
  return `${formatPreviewDuration(durationSeconds)} · ${formatDistance(distanceMeters)}`;
}

/**
 * Pushes the phone's resolved map style (dark/light, satellite preference,
 * housenumbers hidden in navigation like the phone) to the CarPlay map.
 * No-ops unless the resolved style actually changed — the JSON is large and
 * the store subscribers fire on every GPS tick.
 */
export function syncMapStyle(): void {
  if (!connected) return;
  const themeMode = useSettingsStore.getState().themeMode;
  const systemDark = Appearance.getColorScheme() === 'dark';
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  const mapStylePref = useMapStore.getState().mapStyle;
  const key = `${isDark ? 'dark' : 'light'}:${mapStylePref}`;
  if (key === lastMapStyleKey) return;
  lastMapStyleKey = key;
  try {
    let style = resolveMapStyle({ mapStylePref, isDark, styleLoadFailed: false });
    style = setLayerVisibilityInStyle(style, 'housenumber', 'none');
    CarPlay.updateMapStyle(style);
  } catch {
    lastMapStyleKey = null;
  }
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

/**
 * Adds a CarPlay search result as an intermediate stop on the active drive,
 * mirroring the phone's add-destination panel. Falls back to starting fresh
 * navigation when nothing is active.
 */
async function onSearchResultAddStop(result: { name?: string; lat?: number; lng?: number }) {
  if (!connected) return;

  const lat = result.lat;
  const lng = result.lng;
  const name = result.name ?? 'Destination';
  if (lat == null || lng == null) return;

  const nav = useNavigationStore.getState();
  if (!nav.isNavigating || !nav.activeRoute || !nav.destination) {
    await onSearchResultSelected(result);
    return;
  }

  // Origin from live nav position (like the phone), viewport as fallback.
  const navPosition = useNavigationTrackingStore.getState().navPosition;
  const { viewport } = useMapStore.getState();
  const origin =
    navPosition != null
      ? { lat: navPosition[1], lng: navPosition[0] }
      : { lat: viewport.lat, lng: viewport.lng };

  try {
    const prefs = useSettingsStore.getState().routePreferences;
    // Insert after the current target (index 1), matching the phone panel.
    const pendingWaypoints = nav.waypoints.slice(nav.currentLegIndex);
    const newWaypoint = { lat, lng, name };
    if (pendingWaypoints.length > 0) {
      pendingWaypoints.splice(1, 0, newWaypoint);
    } else {
      pendingWaypoints.push(newWaypoint);
    }
    const routes = await computeRoute(
      [origin, ...pendingWaypoints, { lat: nav.destination.lat, lng: nav.destination.lng }],
      nav.costing,
      {
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        avoidFerries: prefs.avoidFerries,
      },
    );
    const route = routes[0];
    if (!route) return;
    useNavigationStore.getState().addWaypointAndReplaceRoute(route, pendingWaypoints);
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
    // Phone route-preview summary so units/order match the phone exactly.
    routeSummary: formatCarPlayRouteSummary(
      route.summary.distanceMeters,
      route.summary.durationSeconds,
    ),
    maneuvers: route.legs.flatMap((leg) =>
      leg.maneuvers.map((maneuver) => ({
        instruction: maneuver.instruction,
        // Phone-banner text; the native side prefers it for display.
        displayInstruction: maneuver.verbalPreTransition || maneuver.instruction,
        maneuverType: maneuver.type,
        distanceMeters: maneuver.distanceMeters,
        durationSeconds: maneuver.durationSeconds,
        hasLaneGuidance: maneuver.laneGuidance != null,
      })),
    ),
  };
}
