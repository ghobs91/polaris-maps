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
import type { CarPlaySearchResult } from '../../native/carplay';
import { useNavigationStore } from '../../stores/navigationStore';
import { useMapStore } from '../../stores/mapStore';
import { unifiedSearch } from '../search/unifiedSearch';
import { computeRoute } from '../routing/routingService';
import type { EmitterSubscription } from 'react-native';

let initialized = false;
let connected = false;
let subscriptions: EmitterSubscription[] = [];
let navUnsubscribe: (() => void) | null = null;

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
}

/** Tear down all listeners. Primarily for tests. */
export function teardownCarPlay(): void {
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
  navUnsubscribe?.();
  navUnsubscribe = null;
  initialized = false;
  connected = false;
}

/** Whether CarPlay is currently connected. */
export function isCarPlayConnected(): boolean {
  return connected;
}

// ---------------------------------------------------------------------------
// Internal event handlers
// ---------------------------------------------------------------------------

function onConnected() {
  connected = true;

  // Sync current navigation state whenever it changes
  navUnsubscribe = useNavigationStore.subscribe(syncNavigationState);

  // If navigation is already active, push initial state
  syncNavigationState(useNavigationStore.getState());
}

function onDisconnected() {
  connected = false;
  navUnsubscribe?.();
  navUnsubscribe = null;
}

function syncNavigationState(state: ReturnType<typeof useNavigationStore.getState>) {
  if (!connected) return;

  if (!state.isNavigating || !state.activeRoute || !state.currentManeuver) {
    CarPlay.updateNavigation({ isNavigating: false } as any);
    return;
  }

  const allManeuvers = state.activeRoute.legs.flatMap((l) => l.maneuvers);
  const nextManeuver = allManeuvers[state.currentStepIndex + 1];

  CarPlay.updateNavigation({
    isNavigating: true,
    instruction: state.currentManeuver.instruction,
    maneuverType: state.currentManeuver.type,
    distanceToTurnMeters: state.currentManeuver.distanceMeters,
    durationToTurnSeconds: state.currentManeuver.durationSeconds,
    etaSeconds: state.trafficEtaSeconds ?? state.etaSeconds ?? 0,
    remainingDistanceMeters: state.remainingDistanceMeters ?? 0,
    nextInstruction: nextManeuver?.instruction,
    nextManeuverType: nextManeuver?.type,
    nextDistanceMeters: nextManeuver?.distanceMeters,
    nextDurationSeconds: nextManeuver?.durationSeconds,
  });
}

async function onSearchQuery({ query }: { query: string }) {
  if (!connected) return;

  const { viewport } = useMapStore.getState();
  try {
    const results = await unifiedSearch(query, {
      lat: viewport.lat,
      lng: viewport.lng,
      zoom: viewport.zoom,
    });

    const carPlayResults: CarPlaySearchResult[] = results.slice(0, 12).map((r) => ({
      name: r.name,
      subtitle: r.subtitle,
      lat: r.lat,
      lng: r.lng,
    }));

    CarPlay.pushSearchResults(carPlayResults);
  } catch {
    CarPlay.pushSearchResults([]);
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

    // Build maneuver list for CarPlay
    const maneuvers = route.legs.flatMap((leg) =>
      leg.maneuvers.map((m) => ({
        instruction: m.instruction,
        maneuverType: m.type,
        distanceMeters: m.distanceMeters,
        durationSeconds: m.durationSeconds,
      })),
    );

    // Start navigation on CarPlay display
    CarPlay.startNavigation({
      destinationName: name,
      destinationLat: lat,
      destinationLng: lng,
      encodedPolyline: route.geometry,
      maneuvers,
    });

    // Also start navigation in the phone-side store so state stays in sync
    useNavigationStore.getState().startNavigation(route, [], { lat, lng, name }, 'auto');
  } catch {
    // Route computation failed — silently ignore on CarPlay
  }
}
