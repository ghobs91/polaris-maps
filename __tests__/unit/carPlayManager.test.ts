// Mock native modules
jest.mock('react-native', () => {
  const addListener = jest.fn().mockReturnValue({ remove: jest.fn() });
  return {
    Platform: { OS: 'ios' },
    NativeModules: {
      PolarisCarPlay: {
        updateNavigation: jest.fn(),
        startNavigation: jest.fn(),
        endNavigation: jest.fn(),
        updateRouteTraffic: jest.fn(),
        showReroutingAlert: jest.fn(),
        hideNavigationAlert: jest.fn(),
        pushSearchResults: jest.fn(),
        updateMapCenter: jest.fn(),
        isConnected: jest.fn().mockResolvedValue(false),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
      },
    },
    NativeEventEmitter: jest.fn().mockImplementation(() => ({
      addListener,
      removeAllListeners: jest.fn(),
    })),
  };
});
jest.mock('expo-sqlite', () => ({}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '1234567890abcdef1234567890abcdef'),
}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));
jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));
jest.mock('../../src/native/valhalla', () => ({
  computeRoute: jest.fn(),
  reroute: jest.fn(),
  initialize: jest.fn(),
  hasCoverage: jest.fn(),
  getLoadedRegions: jest.fn(),
  updateTrafficSpeeds: jest.fn(),
  dispose: jest.fn(),
}));
jest.mock('../../src/services/regions/connectivityService', () => ({
  isOnline: jest.fn().mockReturnValue(true),
}));
jest.mock('../../src/services/search/unifiedSearch', () => ({ unifiedSearch: jest.fn() }));
jest.mock('../../src/services/routing/routingService', () => ({ computeRoute: jest.fn() }));

import { NativeModules } from 'react-native';
import {
  initCarPlay,
  teardownCarPlay,
  isCarPlayConnected,
} from '../../src/services/carplay/carPlayManager';
import * as CarPlay from '../../src/native/carplay';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import { useTrafficStore } from '../../src/stores/trafficStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { toCarPlaySpeedLimit } from '../../src/services/carplay/carPlayManager';
import { encodePolyline } from '../../src/utils/polyline';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';
import { unifiedSearch } from '../../src/services/search/unifiedSearch';
import { computeRoute } from '../../src/services/routing/routingService';
import type { ValhallaRoute } from '../../src/models/route';

// Grab a reference to the emitter created at module load time (before clearAllMocks)
const carPlayEmitter = CarPlay.emitter!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map of event name → latest listener registered by initCarPlay. */
let eventListeners: Record<string, (...args: unknown[]) => void> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoute(): ValhallaRoute {
  return {
    summary: { distanceMeters: 5000, durationSeconds: 600, hasToll: false, hasFerry: false },
    legs: [
      {
        distanceMeters: 5000,
        durationSeconds: 600,
        maneuvers: [
          {
            type: 'start',
            instruction: 'Head north on Main St',
            distanceMeters: 200,
            durationSeconds: 30,
            beginShapeIndex: 0,
            endShapeIndex: 2,
            streetNames: ['Main St'],
            verbalPreTransition: 'Head north on Main Street',
          },
          {
            type: 'turn_right',
            instruction: 'Turn right onto Oak Ave',
            distanceMeters: 800,
            durationSeconds: 90,
            beginShapeIndex: 2,
            endShapeIndex: 5,
            streetNames: ['Oak Ave'],
            verbalPreTransition: 'Turn right onto Oak Avenue',
          },
          {
            type: 'destination',
            instruction: 'Arrive at destination',
            distanceMeters: 0,
            durationSeconds: 0,
            beginShapeIndex: 5,
            endShapeIndex: 5,
            verbalPreTransition: 'You have arrived',
          },
        ],
      },
    ],
    geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    boundingBox: [-73.99, 40.74, -73.97, 40.76],
  };
}

/** Simulates the native CarPlay emitter firing an event. */
function fireEvent(eventName: string, data?: Record<string, unknown>) {
  const listener = eventListeners[eventName];
  if (!listener) throw new Error(`No listener for event: ${eventName}`);
  listener(data ?? {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CarPlayManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    teardownCarPlay();
    useNavigationStore.getState().stopNavigation();
    useNavigationTrackingStore.getState().setDistanceToTurn(null);
    useTrafficStore.getState().setNormalizedSegments([]);
    useSettingsStore.getState().setUseMetric(false);
    eventListeners = {};
    NativeModules.PolarisCarPlay.isConnected.mockResolvedValue(false);

    // Spy on addListener to capture event handlers registered by initCarPlay
    jest.spyOn(carPlayEmitter, 'addListener').mockImplementation((event: string, handler: any) => {
      eventListeners[event] = handler;
      return { remove: jest.fn() } as any;
    });
  });

  it('initialises and registers event listeners', () => {
    initCarPlay();
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayConnected',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayDisconnected',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith('searchQuery', expect.any(Function));
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'searchResultSelected',
      expect.any(Function),
    );
  });

  it('does not initialise twice', () => {
    initCarPlay();
    initCarPlay();
    // addListener should be called only 4 times (once per event), not 8
    expect(carPlayEmitter.addListener).toHaveBeenCalledTimes(4);
  });

  it('tracks connected state', () => {
    initCarPlay();
    expect(isCarPlayConnected()).toBe(false);
    fireEvent('carPlayConnected');
    expect(isCarPlayConnected()).toBe(true);
    fireEvent('carPlayDisconnected');
    expect(isCarPlayConnected()).toBe(false);
  });

  it('hydrates an already-connected native CarPlay session during init', async () => {
    const route = makeRoute();
    NativeModules.PolarisCarPlay.isConnected.mockResolvedValue(true);
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    initCarPlay();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(NativeModules.PolarisCarPlay.isConnected).toHaveBeenCalled();
    expect(isCarPlayConnected()).toBe(true);
    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        isNavigating: true,
        instruction: 'Head north on Main St',
        maneuverType: 'start',
      }),
    );
  });

  it('syncs active navigation state to CarPlay on connect', () => {
    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    initCarPlay();
    fireEvent('carPlayConnected');

    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Dest',
        destinationLat: 40.76,
        destinationLng: -73.97,
        encodedPolyline: route.geometry,
      }),
    );
    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        isNavigating: true,
        instruction: 'Head north on Main St',
        maneuverType: 'start',
      }),
    );
  });

  it('starts a CarPlay navigation session when phone navigation starts while connected', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Dest',
        destinationLat: 40.76,
        destinationLng: -73.97,
        encodedPolyline: route.geometry,
      }),
    );
  });

  it('does not tear down a session that was never started', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    // No navigation was ever pushed, so there is no session to finish.
    // (Spamming finishTrip while idle flickers stale guidance on some units.)
    expect(NativeModules.PolarisCarPlay.updateNavigation).not.toHaveBeenCalled();
    expect(NativeModules.PolarisCarPlay.endNavigation).not.toHaveBeenCalled();
  });

  it('ends the CarPlay session once when navigation stops', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    useNavigationStore.getState().stopNavigation();

    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ isNavigating: false }),
    );
    expect(NativeModules.PolarisCarPlay.endNavigation).toHaveBeenCalledTimes(1);

    // Further idle store emissions must not re-finish the session.
    jest.clearAllMocks();
    useNavigationStore.getState().updateEta(100, 500);
    expect(NativeModules.PolarisCarPlay.updateNavigation).not.toHaveBeenCalled();
    expect(NativeModules.PolarisCarPlay.endNavigation).not.toHaveBeenCalled();
  });

  it('mirrors the phone banner: live countdown, display text, lanes, speed limit', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    const route = makeRoute();
    // Enrich the first maneuver the way the routing pipeline does.
    route.legs[0].maneuvers[0] = {
      ...route.legs[0].maneuvers[0],
      speedLimitMph: 25,
      laneGuidance: {
        laneCount: 3,
        activeLanes: [1, 2],
        laneDirections: ['straight', 'straight', 'right'],
      },
    };
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    useNavigationTrackingStore.getState().setDistanceToTurn(87);

    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        isNavigating: true,
        instruction: 'Head north on Main St',
        displayInstruction: 'Head north on Main Street',
        maneuverType: 'start',
        // Live tracking countdown wins over the static 200 m route value.
        distanceToTurnMeters: 87,
        speedLimitValue: 25,
        speedLimitUnit: 'mph',
        laneGuidance: {
          laneCount: 3,
          activeLanes: [1, 2],
          laneDirections: ['straight', 'straight', 'right'],
        },
        isRerouting: false,
      }),
    );
    expect(NativeModules.PolarisCarPlay.showReroutingAlert).not.toHaveBeenCalled();
  });

  it('shows and hides the rerouting alert on transitions only', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    useNavigationStore.getState().setRerouting(true);
    expect(NativeModules.PolarisCarPlay.showReroutingAlert).toHaveBeenCalledTimes(1);

    // Repeat emission while still rerouting must not re-present the alert.
    useNavigationStore.getState().updateEta(500, 4000);
    expect(NativeModules.PolarisCarPlay.showReroutingAlert).toHaveBeenCalledTimes(1);

    useNavigationStore.getState().setRerouting(false);
    useNavigationStore.getState().setDeviated(false);
    expect(NativeModules.PolarisCarPlay.hideNavigationAlert).toHaveBeenCalledTimes(1);
  });

  it('converts the speed limit to metric when preferred', () => {
    expect(toCarPlaySpeedLimit(undefined)).toEqual({});
    expect(toCarPlaySpeedLimit(25)).toEqual({ speedLimitValue: 25, speedLimitUnit: 'mph' });

    useSettingsStore.getState().setUseMetric(true);
    // 25 mph → 40 km/h, matching the phone's SpeedLimitSign.
    expect(toCarPlaySpeedLimit(25)).toEqual({ speedLimitValue: 40, speedLimitUnit: 'km/h' });

    initCarPlay();
    fireEvent('carPlayConnected');
    const route = makeRoute();
    route.legs[0].maneuvers[0] = { ...route.legs[0].maneuvers[0], speedLimitMph: 25 };
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ speedLimitValue: 40, speedLimitUnit: 'km/h' }),
    );
  });

  function makeTrafficSegment(): NormalizedTrafficSegment {
    return {
      id: 'seg-1',
      coordinates: [
        [-73.98, 40.75],
        [-73.97, 40.76],
      ],
      currentSpeedMph: 8,
      freeFlowSpeedMph: 30,
      congestionRatio: 0.1,
      confidence: 0.9,
      source: 'tomtom',
      timestamp: Date.now(),
    };
  }

  it('pushes traffic-colored ranges on route start and traffic updates', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    const geometry = encodePolyline([
      [-73.98, 40.75],
      [-73.975, 40.755],
      [-73.97, 40.76],
    ]);
    const route = { ...makeRoute(), geometry };
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    // No traffic data yet — nothing to send.
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).not.toHaveBeenCalled();

    useTrafficStore.getState().setNormalizedSegments([makeTrafficSegment()]);
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).toHaveBeenCalledTimes(1);
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).toHaveBeenCalledWith([
      { color: '#D50000', from: 0, to: 2 },
    ]);

    // Identical colors re-emitted (new array identity) must not re-send.
    useTrafficStore.getState().setNormalizedSegments([makeTrafficSegment()]);
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).toHaveBeenCalledTimes(1);

    // Traffic cleared → native falls back to the plain blue core.
    useTrafficStore.getState().setNormalizedSegments([]);
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).toHaveBeenCalledTimes(2);
    expect(NativeModules.PolarisCarPlay.updateRouteTraffic).toHaveBeenLastCalledWith([]);
  });

  it('pushes search results to CarPlay', async () => {
    (unifiedSearch as jest.Mock).mockResolvedValue([
      {
        name: 'Coffee Shop',
        subtitle: '123 Main St',
        lat: 40.75,
        lng: -73.98,
        score: 80,
        distanceKm: 0.5,
        type: 'poi',
      },
      {
        name: 'Tea House',
        subtitle: '456 Oak Ave',
        lat: 40.76,
        lng: -73.97,
        score: 70,
        distanceKm: 1.2,
        type: 'poi',
      },
    ]);

    initCarPlay();
    fireEvent('carPlayConnected');
    fireEvent('searchQuery', { query: 'coffee' });

    // Let the async search resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(unifiedSearch).toHaveBeenCalledWith('coffee', expect.any(Object));
    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith([
      { name: 'Coffee Shop', subtitle: '123 Main St', lat: 40.75, lng: -73.98 },
      { name: 'Tea House', subtitle: '456 Oak Ave', lat: 40.76, lng: -73.97 },
    ]);
  });

  it('starts navigation when a search result is selected', async () => {
    const route = makeRoute();
    (computeRoute as jest.Mock).mockResolvedValue([route]);

    initCarPlay();
    fireEvent('carPlayConnected');
    fireEvent('searchResultSelected', { name: 'Coffee Shop', lat: 40.75, lng: -73.98 });

    await new Promise((r) => setTimeout(r, 10));

    expect(computeRoute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ lat: expect.any(Number) }),
        { lat: 40.75, lng: -73.98 },
      ]),
      'auto',
    );
    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Coffee Shop',
        destinationLat: 40.75,
        destinationLng: -73.98,
      }),
    );
    // Phone-side navigation should also be active
    expect(useNavigationStore.getState().isNavigating).toBe(true);
  });

  it('teardown cleans up listeners and state', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    expect(isCarPlayConnected()).toBe(true);

    teardownCarPlay();
    expect(isCarPlayConnected()).toBe(false);
  });

  it('pushes empty results when search fails', async () => {
    (unifiedSearch as jest.Mock).mockRejectedValue(new Error('Network error'));

    initCarPlay();
    fireEvent('carPlayConnected');
    fireEvent('searchQuery', { query: 'pizza' });

    await new Promise((r) => setTimeout(r, 10));

    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith([]);
  });
});
