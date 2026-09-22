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
import * as Location from 'expo-location';
import * as CarPlay from '../../native/carplay';
import type { CarPlayStartNavigationData } from '../../native/carplay';
import { useNavigationStore } from '../../stores/navigationStore';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useTrafficStore } from '../../stores/trafficStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMapStore } from '../../stores/mapStore';
import { buildCarPlayTrafficRanges, trafficRangesSignature } from './carPlayTrafficRanges';
import { createSearchSession, type SearchSession } from '../search/searchSession';
import { computeRoute } from '../routing/routingService';
import { formatDistance } from '../../utils/units';
import { resolveMapStyle, setLayerVisibilityInStyle } from '../../components/map/mapStyleResolver';
import {
  averageRouteTrafficColor,
  ETA_COLOR_ORANGE,
  ETA_COLOR_RED,
} from '../traffic/routeTrafficService';
import { decodePolyline } from '../../utils/polyline';
import { getFavorites, subscribeFavorites } from '../favorites/favoritesService';
import { getSearchHistory } from '../search/searchHistoryService';
import { useCarPlayStore } from '../../stores/carPlayStore';
import { findIncidentsAhead } from '../traffic/incidentAhead';
import { INCIDENT_TYPE_LABELS } from '../traffic/incidentWire';
import { haversineMeters } from '../../utils/routeSnap';
import type { CarPlaySearchResult, CarPlayIncidentMarker } from '../../native/carplay';
import type { EmitterSubscription } from 'react-native';

let initialized = false;
let connected = false;
let subscriptions: EmitterSubscription[] = [];
let navUnsubscribe: (() => void) | null = null;
let trackingUnsubscribe: (() => void) | null = null;
let trafficUnsubscribe: (() => void) | null = null;
let settingsUnsubscribe: (() => void) | null = null;
let mapStyleUnsubscribe: (() => void) | null = null;
let favoritesUnsubscribe: (() => void) | null = null;
let appearanceSubscription: { remove: () => void } | null = null;
let lastMapStyleKey: string | null = null;
let carPlayDark: boolean | null = null;
let carPlayRouteKey: string | null = null;
let previewKey: string | null = null;
let rerouteAlertShown = false;
let lastDistanceBucket: number | null = null;
let lastTrafficSignature = '';
let searchSession: SearchSession | null = null;
let mapCenterUpdateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMapCenter: { lat: number; lng: number; heading: number } | null = null;
let arrivalShown = false;
let lastIncidentCheckAt = 0;
let warnedIncidentIds = new Set<string>();
let lastIncidentSignature = '';

/** Throttle for the incident look-ahead, matching the phone's banner. */
const INCIDENT_CHECK_INTERVAL_MS = 10_000;

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
    CarPlay.emitter.addListener('carPlayRouteStart', onRouteStart),
    CarPlay.emitter.addListener('carPlayContentStyleChanged', onContentStyleChanged),
    CarPlay.emitter.addListener('carPlayToggleMute', onToggleMute),
    CarPlay.emitter.addListener('carPlayArrivalDismiss', onArrivalDismiss),
    CarPlay.emitter.addListener('carPlayDashboardFavorite', onDashboardFavorite),
    CarPlay.emitter.addListener('carPlayNavigationCancelled', onNavigationCancelled),
    CarPlay.emitter.addListener('carPlayLocateRequest', onLocateRequest),
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
  favoritesUnsubscribe?.();
  favoritesUnsubscribe = null;
  appearanceSubscription?.remove();
  appearanceSubscription = null;
  lastMapStyleKey = null;
  carPlayDark = null;
  clearMapCenterUpdate();
  searchSession?.cancel();
  initialized = false;
  connected = false;
  useCarPlayStore.getState().setConnected(false);
  carPlayRouteKey = null;
  previewKey = null;
  rerouteAlertShown = false;
  arrivalShown = false;
  lastIncidentCheckAt = 0;
  warnedIncidentIds = new Set();
  lastIncidentSignature = '';
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
  useCarPlayStore.getState().setConnected(true);

  // Sync current navigation state whenever it changes
  navUnsubscribe?.();
  navUnsubscribe = useNavigationStore.subscribe(syncNavigationState);
  trackingUnsubscribe?.();
  trackingUnsubscribe = useNavigationTrackingStore.subscribe(onTrackingUpdate);
  trafficUnsubscribe?.();
  trafficUnsubscribe = useTrafficStore.subscribe(() => {
    syncRouteTraffic();
    syncIncidents();
  });
  settingsUnsubscribe?.();
  settingsUnsubscribe = useSettingsStore.subscribe(syncMapStyle);
  mapStyleUnsubscribe?.();
  mapStyleUnsubscribe = useMapStore.subscribe(syncMapStyle);
  favoritesUnsubscribe?.();
  favoritesUnsubscribe = subscribeFavorites(pushHomeSuggestions);

  // Push the phone's current map style (dark/light, satellite) so the
  // CarPlay map matches the phone map.
  lastMapStyleKey = null;
  syncMapStyle();

  // If navigation is already active, push initial state
  syncNavigationState(useNavigationStore.getState());

  // Pre-search suggestions for the floating map panel.
  pushHomeSuggestions();

  // Center the idle map on the driver instead of leaving it at the native
  // host's (0, 0) default ("blank ocean"). No-op while navigating, where the
  // tracking pipeline already owns the camera.
  void pushUserLocation();
}

function onDisconnected() {
  connected = false;
  useCarPlayStore.getState().setConnected(false);
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
  favoritesUnsubscribe?.();
  favoritesUnsubscribe = null;
  lastMapStyleKey = null;
  carPlayDark = null;
  clearMapCenterUpdate();
  searchSession?.cancel();
  carPlayRouteKey = null;
  previewKey = null;
  rerouteAlertShown = false;
  arrivalShown = false;
  lastIncidentCheckAt = 0;
  warnedIncidentIds = new Set();
  lastIncidentSignature = '';
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
    syncIncidents();
    syncRoutePreview(state);
    return;
  }

  // Navigation won the race with a preview the driver was still comparing.
  if (previewKey !== null) {
    previewKey = null;
    CarPlay.hideTripPreview();
  }

  const routeKey = `${state.activeRoute.geometry}:${state.destination.lat}:${state.destination.lng}`;
  if (carPlayRouteKey !== routeKey) {
    CarPlay.startNavigation(toCarPlayNavigationData(state));
    carPlayRouteKey = routeKey;
    // Fresh route — re-evaluate traffic colors even if the store didn't change.
    lastTrafficSignature = '';
    arrivalShown = false;
    lastIncidentCheckAt = 0;
    warnedIncidentIds = new Set();
    lastIncidentSignature = '';
    syncRouteTraffic();
    syncIncidents();
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
    muted: state.muted,
    etaColor: selectCarPlayEtaColor(state),
    highwayExitLabel: maneuver.exitNumber ?? maneuver.exitBranch,
    useMetric: useSettingsStore.getState().useMetric,
  });

  if (state.hasArrived && !arrivalShown) {
    arrivalShown = true;
    CarPlay.showArrival({ destinationName: state.destination.name ?? 'your destination' });
  } else if (!state.hasArrived) {
    arrivalShown = false;
  }
  syncMapCenter(tracking);
}

/**
 * Warns about the nearest crowd-reported incident ahead on the active route,
 * reusing the phone's `findIncidentsAhead` and announcing each incident once
 * per navigation session (mirrors `IncidentAheadBanner`).
 */
function checkIncidentsAhead(
  tracking: ReturnType<typeof useNavigationTrackingStore.getState>,
): void {
  if (!tracking.navPosition) return;
  const now = Date.now();
  if (now - lastIncidentCheckAt < INCIDENT_CHECK_INTERVAL_MS) return;
  lastIncidentCheckAt = now;

  const nav = useNavigationStore.getState();
  if (!nav.activeRoute) return;
  const routeCoords = decodePolyline(nav.activeRoute.geometry);
  const ahead = findIncidentsAhead(
    routeCoords,
    tracking.navPosition,
    useTrafficStore.getState().incidents,
  );
  const next = ahead.find((incident) => !warnedIncidentIds.has(incident.id));
  if (!next) return;

  warnedIncidentIds.add(next.id);
  CarPlay.showIncidentAlert({
    label: INCIDENT_TYPE_LABELS[next.type],
    distanceMeters: haversineMeters(tracking.navPosition, [next.lng, next.lat]),
  });
}

/** Phone EtaDisplay's overall traffic color, mapped to the CarPlay enum. */
export function selectCarPlayEtaColor(
  state: Pick<ReturnType<typeof useNavigationStore.getState>, 'activeRoute'>,
): 'green' | 'orange' | 'red' {
  if (!state.activeRoute) return 'green';
  const color = averageRouteTrafficColor(
    decodePolyline(state.activeRoute.geometry),
    useTrafficStore.getState().normalizedSegments,
  );
  if (color === ETA_COLOR_ORANGE) return 'orange';
  if (color === ETA_COLOR_RED) return 'red';
  return 'green';
}

/**
 * Mirrors the phone's route-preview state as an Apple/Google-style CarPlay
 * trip preview: every computed route becomes a `CPRouteChoice`, and the driver
 * starts one by tapping Go (native then emits `carPlayRouteStart`).
 */
function syncRoutePreview(state: ReturnType<typeof useNavigationStore.getState>): void {
  if (!state.routePreview || !state.routePreviewDestination) {
    if (previewKey !== null) {
      previewKey = null;
      CarPlay.hideTripPreview();
    }
    return;
  }

  const destination = state.routePreviewDestination;
  const routes = [state.routePreview, ...state.routePreviewAlternates];
  const key = `${routes.map((route) => route.geometry).join('|')}:${destination.lat}:${destination.lng}`;
  if (key === previewKey) return;
  previewKey = key;

  CarPlay.showTripPreview({
    destinationName: destination.name ?? 'Destination',
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    useMetric: useSettingsStore.getState().useMetric,
    routes: routes.map((route) => ({
      encodedPolyline: route.geometry,
      summary: formatCarPlayRouteSummary(
        route.summary.distanceMeters,
        route.summary.durationSeconds,
      ),
      distanceMeters: route.summary.distanceMeters,
      durationSeconds: route.summary.durationSeconds,
    })),
  });
}

/** Starts the phone-side trip the driver selected in the CarPlay preview. */
function onRouteStart({ index }: { index?: number }): void {
  if (!connected) return;
  const state = useNavigationStore.getState();
  if (!state.routePreview || !state.routePreviewDestination) return;
  const routes = [state.routePreview, ...state.routePreviewAlternates];
  const selected = routes[index ?? 0];
  if (!selected) return;
  useNavigationStore.getState().startNavigation(
    selected,
    routes.filter((route) => route !== selected),
    state.routePreviewDestination,
    state.routePreviewCosting,
    state.routePreviewWaypoints,
  );
}

/** The head unit switched light/dark; re-resolve the phone map style. */
function onContentStyleChanged({ dark }: { dark?: boolean }): void {
  carPlayDark = dark ?? null;
  lastMapStyleKey = null;
  syncMapStyle();
}

/** CarPlay's mute button toggled voice guidance. */
function onToggleMute(): void {
  const nav = useNavigationStore.getState();
  nav.setMuted(!nav.muted);
}

/** The driver tapped Done on the CarPlay arrival card; end on the phone too. */
function onArrivalDismiss(): void {
  arrivalShown = false;
  useNavigationStore.getState().stopNavigation();
}

/** The driver ended the trip from CarPlay; stop navigation on the phone too. */
function onNavigationCancelled(): void {
  const nav = useNavigationStore.getState();
  if (nav.isNavigating) nav.stopNavigation();
}

/** CarPlay dashboard shortcut (Home/Work): preview navigation to that favorite. */
async function onDashboardFavorite({ kind }: { kind?: string }): Promise<void> {
  if (!connected || !kind) return;
  const favorite = getFavorites().find((entry) => entry.kind === kind);
  if (!favorite) return;
  const { viewport } = useMapStore.getState();
  const prefs = useSettingsStore.getState().routePreferences;
  try {
    const routes = await computeRoute(
      [
        { lat: viewport.lat, lng: viewport.lng },
        { lat: favorite.entry.lat, lng: favorite.entry.lng },
      ],
      'auto',
      {
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        avoidFerries: prefs.avoidFerries,
        alternates: 2,
      },
    );
    const route = routes[0];
    if (!route) return;
    useNavigationStore
      .getState()
      .setRoutePreview(
        route,
        routes.slice(1),
        { lat: favorite.entry.lat, lng: favorite.entry.lng, name: favorite.label },
        'auto',
      );
  } catch {
    // Route computation failed — silently ignore on CarPlay
  }
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
  // The head unit's content style wins while CarPlay is attached, so the map
  // matches the car rather than the phone's theme.
  const isDark = carPlayDark ?? (themeMode === 'dark' || (themeMode === 'system' && systemDark));
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
 * Draws the phone's crowd-reported incidents on the CarPlay map, mirroring
 * `IncidentLayer`. Only active during navigation; clears when the trip ends.
 * No-ops unless the marker set actually changed.
 */
function syncIncidents(): void {
  if (!connected) return;
  const nav = useNavigationStore.getState();
  if (!nav.isNavigating) {
    if (lastIncidentSignature !== '') {
      lastIncidentSignature = '';
      CarPlay.updateIncidents([]);
    }
    return;
  }
  const markers: CarPlayIncidentMarker[] = useTrafficStore
    .getState()
    .incidents.filter((incident) => incident.expiresAt > Date.now())
    .map((incident) => ({ type: incident.type, lat: incident.lat, lng: incident.lng }));
  const signature = markers
    .map((marker) => `${marker.type}:${marker.lat.toFixed(5)},${marker.lng.toFixed(5)}`)
    .join(';');
  if (signature === lastIncidentSignature) return;
  lastIncidentSignature = signature;
  CarPlay.updateIncidents(markers);
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
  checkIncidentsAhead(state);
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

/** CarPlay's Locate/Recenter button: refresh the map from the phone's GPS. */
function onLocateRequest(): void {
  void pushUserLocation();
}

/**
 * Centers the CarPlay map on the driver's live position. Runs on connect and
 * when the driver taps Locate/Recenter, since the native map host has no
 * position of its own outside navigation.
 */
async function pushUserLocation(): Promise<void> {
  if (!locationPushAllowed()) return;

  let pushed = false;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (!locationPushAllowed()) return;
    if (status !== 'granted') {
      syncFallbackCenter();
      return;
    }
    // Last-known first for an instant response, then the fresh fix. Re-check
    // between awaits: a trip preview or active navigation can start while the
    // GPS call is in flight, and its camera fit must win.
    const last = await Location.getLastKnownPositionAsync();
    if (last && locationPushAllowed()) {
      CarPlay.updateMapCenter(last.coords.latitude, last.coords.longitude, 0);
      pushed = true;
    }
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    if (locationPushAllowed()) {
      CarPlay.updateMapCenter(current.coords.latitude, current.coords.longitude, 0);
      pushed = true;
    }
  } catch {
    // Fall through to the viewport fallback.
  }
  if (!pushed && locationPushAllowed()) syncFallbackCenter();
}

/**
 * Whether the idle GPS locate may move the camera: never while driving (the
 * tracking pipeline owns the camera) and never while a trip preview is up
 * (the route-overview fit owns it instead).
 */
function locationPushAllowed(): boolean {
  if (!connected) return false;
  const nav = useNavigationStore.getState();
  return !nav.isNavigating && !nav.routePreview;
}

/** Last phone map viewport center, used when GPS is unavailable. */
function syncFallbackCenter(): void {
  const { viewport } = useMapStore.getState();
  if (!viewport || (viewport.lat === 0 && viewport.lng === 0)) return;
  CarPlay.updateMapCenter(viewport.lat, viewport.lng, 0);
}

function getSearchSession(): SearchSession {
  if (!searchSession) {
    searchSession = createSearchSession({
      limit: 12,
      getContext: () => {
        const { viewport } = useMapStore.getState();
        return { lat: viewport.lat, lng: viewport.lng, zoom: viewport.zoom };
      },
      onResults: (results) => {
        if (!connected) return;
        CarPlay.pushSearchResults(
          results.slice(0, 12).map((r) => ({
            name: r.name,
            subtitle: r.subtitle,
            lat: r.lat,
            lng: r.lng,
          })),
        );
      },
      onError: () => {
        if (connected) CarPlay.pushSearchResults([]);
      },
    });
  }
  return searchSession;
}

async function onSearchQuery({ query }: { query: string }) {
  if (!connected) return;
  // Empty query: clear the search list. Saved/recents places live in the
  // floating map panel (`pushHomeSuggestions`), so the keyboard never covers
  // a list of suggestions.
  if (!query.trim()) {
    searchSession?.cancel();
    CarPlay.pushSearchResults([]);
    return;
  }
  await getSearchSession().submit(query);
}

/** Pushes the Pinned/Recents suggestions for the floating CarPlay map panel. */
function pushHomeSuggestions(): void {
  if (!connected) return;
  CarPlay.updateHomeSuggestions(emptyQueryResults());
}

/**
 * Pre-search list, Apple Maps style: a "Pinned" section (Home → Work → pins,
 * matching `favoritesService`'s ordering) followed by a "Recents" section
 * built from the phone's search history. `kind` drives the row icon; `section`
 * groups rows under headers on the native side.
 */
function emptyQueryResults(): CarPlaySearchResult[] {
  const pinned: CarPlaySearchResult[] = getFavorites().map((favorite) => ({
    name: favorite.label,
    subtitle: favorite.kind === 'home' ? 'Close by' : favorite.entry.text,
    lat: favorite.entry.lat,
    lng: favorite.entry.lng,
    kind: favorite.kind,
    section: 'pinned',
  }));

  const recents: CarPlaySearchResult[] = getSearchHistory().map((entry) => {
    const region = [entry.entry.city, entry.entry.state].filter(Boolean).join(', ');
    return {
      name: entry.entry.text,
      subtitle: region || entry.query || 'Recent',
      lat: entry.entry.lat,
      lng: entry.entry.lng,
      kind: 'recent',
      section: 'recent',
    };
  });

  return [...pinned, ...recents];
}

async function onSearchResultSelected(result: { name?: string; lat?: number; lng?: number }) {
  if (!connected) return;

  const lat = result.lat;
  const lng = result.lng;
  const name = result.name ?? 'Destination';
  if (lat == null || lng == null) return;

  // Get current location from map viewport as origin
  const { viewport } = useMapStore.getState();
  const prefs = useSettingsStore.getState().routePreferences;

  try {
    const routes = await computeRoute(
      [
        { lat: viewport.lat, lng: viewport.lng },
        { lat, lng },
      ],
      'auto',
      {
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        avoidFerries: prefs.avoidFerries,
        alternates: 2,
      },
    );

    const route = routes[0];
    if (!route) return;

    // Show the phone's route preview; the driver compares options and taps Go,
    // which native reports back via `carPlayRouteStart`.
    useNavigationStore
      .getState()
      .setRoutePreview(route, routes.slice(1), { lat, lng, name }, 'auto');
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
    useMetric: useSettingsStore.getState().useMetric,
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
