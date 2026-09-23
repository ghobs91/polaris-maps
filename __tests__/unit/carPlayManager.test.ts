// Mock native modules
let mockAppState = 'active';
jest.mock('react-native', () => {
  const addListener = jest.fn().mockReturnValue({ remove: jest.fn() });
  return {
    Platform: { OS: 'ios' },
    AppState: {
      get currentState() {
        return mockAppState;
      },
    },
    Appearance: {
      getColorScheme: jest.fn(() => 'light'),
      addChangeListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    NativeModules: {
      PolarisCarPlay: {
        updateNavigation: jest.fn(),
        startNavigation: jest.fn(),
        endNavigation: jest.fn(),
        showTripPreview: jest.fn(),
        hideTripPreview: jest.fn(),
        showArrival: jest.fn(),
        showIncidentAlert: jest.fn(),
        updateIncidents: jest.fn(),
        updateRouteTraffic: jest.fn(),
        showReroutingAlert: jest.fn(),
        hideNavigationAlert: jest.fn(),
        pushSearchResults: jest.fn(),
        updateHomeSuggestions: jest.fn(),
        updateMapCenter: jest.fn(),
        updateMapStyle: jest.fn(),
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
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: 40.7128, longitude: -74.006 },
  }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));
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
jest.mock('../../src/services/favorites/favoritesService', () => ({
  getFavorites: jest.fn(() => []),
  subscribeFavorites: jest.fn(() => jest.fn()),
}));
jest.mock('../../src/services/search/searchHistoryService', () => ({
  getSearchHistory: jest.fn(() => []),
}));
jest.mock('../../src/services/traffic/incidentAhead', () => ({
  findIncidentsAhead: jest.fn(() => []),
}));

import { NativeModules } from 'react-native';
import * as Location from 'expo-location';
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
import { useCarPlayStore } from '../../src/stores/carPlayStore';
import { toCarPlaySpeedLimit } from '../../src/services/carplay/carPlayManager';
import { formatDistance } from '../../src/utils/units';
import { encodePolyline } from '../../src/utils/polyline';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';
import { unifiedSearch } from '../../src/services/search/unifiedSearch';
import { computeRoute } from '../../src/services/routing/routingService';
import { getFavorites } from '../../src/services/favorites/favoritesService';
import { getSearchHistory } from '../../src/services/search/searchHistoryService';
import { findIncidentsAhead } from '../../src/services/traffic/incidentAhead';
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
    useNavigationStore.getState().clearRoutePreview();
    useNavigationTrackingStore.getState().setDistanceToTurn(null);
    useNavigationTrackingStore.getState().setNavPosition(null);
    useTrafficStore.getState().setNormalizedSegments([]);
    useSettingsStore.getState().setUseMetric(false);
    useSettingsStore.getState().setThemeMode('system');
    mockAppState = 'active';
    (getFavorites as jest.Mock).mockReturnValue([]);
    (getSearchHistory as jest.Mock).mockReturnValue([]);
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
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'searchResultAddStop',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayRouteStart',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayContentStyleChanged',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayToggleMute',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayArrivalDismiss',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayDashboardFavorite',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayNavigationCancelled',
      expect.any(Function),
    );
    expect(carPlayEmitter.addListener).toHaveBeenCalledWith(
      'carPlayLocateRequest',
      expect.any(Function),
    );
  });

  it('does not initialise twice', () => {
    initCarPlay();
    initCarPlay();
    // addListener should be called only 12 times (once per event), not 24
    expect(carPlayEmitter.addListener).toHaveBeenCalledTimes(12);
  });

  it('tracks connected state', () => {
    initCarPlay();
    expect(isCarPlayConnected()).toBe(false);
    expect(useCarPlayStore.getState().connected).toBe(false);
    fireEvent('carPlayConnected');
    expect(isCarPlayConnected()).toBe(true);
    expect(useCarPlayStore.getState().connected).toBe(true);
    fireEvent('carPlayDisconnected');
    expect(isCarPlayConnected()).toBe(false);
    expect(useCarPlayStore.getState().connected).toBe(false);
  });

  it('centers the idle CarPlay map on the driver on connect and on locate', async () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Connect pushes the phone's position so the map isn't stuck at (0, 0).
    expect(NativeModules.PolarisCarPlay.updateMapCenter).toHaveBeenCalledWith(40.7128, -74.006, 0);

    (NativeModules.PolarisCarPlay.updateMapCenter as jest.Mock).mockClear();
    fireEvent('carPlayLocateRequest');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(NativeModules.PolarisCarPlay.updateMapCenter).toHaveBeenCalledWith(40.7128, -74.006, 0);
  });

  it('follows the car on the idle CarPlay map', async () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    await new Promise((resolve) => setTimeout(resolve, 0));
    (NativeModules.PolarisCarPlay.updateMapCenter as jest.Mock).mockClear();

    const calls = (Location.watchPositionAsync as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const onUpdate = calls[calls.length - 1][1] as (loc: unknown) => void;
    onUpdate({ coords: { latitude: 40.7, longitude: -74.0, heading: 90, speed: 10 } });

    // Idle map is north-up, so the pushed heading is 0.
    expect(NativeModules.PolarisCarPlay.updateMapCenter).toHaveBeenCalledWith(40.7, -74.0, 0);
  });

  it('pushes each fix to the CarPlay map immediately while the phone is locked', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    // Locked/backgrounded: a throttled setTimeout would never fire before iOS
    // re-suspends the process, leaving CarPlay frozen until unlock.
    mockAppState = 'background';
    useNavigationTrackingStore.getState().setNavPosition([-73.98, 40.75]);
    useNavigationTrackingStore.getState().setNavBearing(42);

    expect(NativeModules.PolarisCarPlay.updateMapCenter).toHaveBeenLastCalledWith(
      40.75,
      -73.98,
      42,
    );
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

  it('scales the trip ETA by remaining distance like the phone EtaDisplay', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    // Half the route remains; full-route traffic ETA is 1200 s.
    useNavigationStore.getState().updateEta(600, 2500);
    useNavigationStore.getState().updateTrafficEta(1200, 600, 1);

    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ etaSeconds: 600 }),
    );
  });

  it('counts down the time-to-turn with the live distance', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    // First maneuver: 200 m in 30 s; halfway there → ~15 s left.
    useNavigationTrackingStore.getState().setDistanceToTurn(100);

    expect(NativeModules.PolarisCarPlay.updateNavigation).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceToTurnMeters: 100, durationToTurnSeconds: 15 }),
    );
  });

  it('sends the phone route-preview summary and banner text on start', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    const route = makeRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        routeSummary: `10 min · ${formatDistance(5000)}`,
      }),
    );
    const payload = (NativeModules.PolarisCarPlay.startNavigation as jest.Mock).mock.calls[0][0];
    expect(payload.maneuvers[0]).toEqual(
      expect.objectContaining({
        instruction: 'Head north on Main St',
        displayInstruction: 'Head north on Main Street',
        hasLaneGuidance: false,
      }),
    );
  });

  it('pushes the phone map style on connect and on theme change only', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenCalledTimes(1);
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenCalledWith(
      expect.stringContaining('Polaris Light'),
    );

    // Unrelated store churn must not resend the ~35 KB style JSON.
    useNavigationStore.getState().updateEta(500, 4000);
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setThemeMode('dark');
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenCalledTimes(2);
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenLastCalledWith(
      expect.stringContaining('Polaris Dark'),
    );
  });

  it('follows the car content style over the phone theme', () => {
    initCarPlay();
    fireEvent('carPlayConnected');
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenLastCalledWith(
      expect.stringContaining('Polaris Light'),
    );

    // The head unit is in dark mode while the phone stays light.
    fireEvent('carPlayContentStyleChanged', { dark: true });
    expect(NativeModules.PolarisCarPlay.updateMapStyle).toHaveBeenLastCalledWith(
      expect.stringContaining('Polaris Dark'),
    );
  });

  it('toggles phone mute from the CarPlay navigation button', () => {
    initCarPlay();
    fireEvent('carPlayConnected');

    expect(useNavigationStore.getState().muted).toBe(false);
    fireEvent('carPlayToggleMute');
    expect(useNavigationStore.getState().muted).toBe(true);
    fireEvent('carPlayToggleMute');
    expect(useNavigationStore.getState().muted).toBe(false);
  });

  it('stops phone navigation when the trip is ended on CarPlay', () => {
    const route = makeRoute();
    initCarPlay();
    fireEvent('carPlayConnected');
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    expect(useNavigationStore.getState().isNavigating).toBe(true);

    fireEvent('carPlayNavigationCancelled');
    expect(useNavigationStore.getState().isNavigating).toBe(false);
  });

  it('shows the arrival card and ends the trip when Done is tapped', () => {
    const route = makeRoute();
    initCarPlay();
    fireEvent('carPlayConnected');
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    useNavigationStore.getState().setArrived(true);
    expect(NativeModules.PolarisCarPlay.showArrival).toHaveBeenCalledWith({
      destinationName: 'Dest',
    });

    fireEvent('carPlayArrivalDismiss');
    expect(useNavigationStore.getState().isNavigating).toBe(false);
  });

  it('draws active incidents on the CarPlay map while navigating', () => {
    const route = makeRoute();
    initCarPlay();
    fireEvent('carPlayConnected');
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    useTrafficStore.getState().setIncidents([
      {
        id: 'inc-1',
        reporterPubkey: 'pk',
        lat: 40.75,
        lng: -73.98,
        geohash6: 'dr5ru7',
        type: 'accident',
        description: '',
        reportedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        signature: new Uint8Array(),
      },
    ]);
    expect(NativeModules.PolarisCarPlay.updateIncidents).toHaveBeenCalledWith([
      { type: 'accident', lat: 40.75, lng: -73.98 },
    ]);

    useTrafficStore.getState().setIncidents([]);
    expect(NativeModules.PolarisCarPlay.updateIncidents).toHaveBeenLastCalledWith([]);
  });

  it('warns about an incident ahead once per incident', () => {
    const route = {
      ...makeRoute(),
      geometry: encodePolyline([
        [-73.98, 40.75],
        [-73.97, 40.76],
      ]),
    };
    (findIncidentsAhead as jest.Mock).mockReturnValue([
      {
        id: 'inc-1',
        type: 'accident',
        lat: 40.755,
        lng: -73.975,
        expiresAt: Date.now() + 60_000,
      },
    ]);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(100_000);
    initCarPlay();
    fireEvent('carPlayConnected');
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    useNavigationTrackingStore.getState().setNavPosition([-73.98, 40.75]);
    expect(NativeModules.PolarisCarPlay.showIncidentAlert).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Accident', distanceMeters: expect.any(Number) }),
    );

    // Past the throttle window, the same incident is not announced again.
    (NativeModules.PolarisCarPlay.showIncidentAlert as jest.Mock).mockClear();
    nowSpy.mockReturnValue(200_000);
    useNavigationTrackingStore.getState().setNavPosition([-73.979, 40.751]);
    expect(NativeModules.PolarisCarPlay.showIncidentAlert).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('adds a search result as a stop on the active drive', async () => {
    const route = makeRoute();
    (computeRoute as jest.Mock).mockResolvedValue([route]);

    initCarPlay();
    fireEvent('carPlayConnected');
    useNavigationStore
      .getState()
      .startNavigation(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');
    jest.clearAllMocks();

    fireEvent('searchResultAddStop', { name: 'Coffee Shop', lat: 40.75, lng: -73.98 });
    await new Promise((r) => setTimeout(r, 10));

    expect(computeRoute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ lat: expect.any(Number) }),
        { lat: 40.75, lng: -73.98, name: 'Coffee Shop' },
        { lat: 40.76, lng: -73.97 },
      ]),
      'auto',
      expect.objectContaining({ avoidTolls: false }),
    );
    expect(useNavigationStore.getState().waypoints).toHaveLength(1);
    expect(useNavigationStore.getState().waypoints[0]).toMatchObject({ name: 'Coffee Shop' });
  });

  it('shows a preview when adding a stop while idle', async () => {
    const route = makeRoute();
    (computeRoute as jest.Mock).mockResolvedValue([route]);

    initCarPlay();
    fireEvent('carPlayConnected');
    jest.clearAllMocks();

    fireEvent('searchResultAddStop', { name: 'Coffee Shop', lat: 40.75, lng: -73.98 });
    await new Promise((r) => setTimeout(r, 10));

    expect(NativeModules.PolarisCarPlay.showTripPreview).toHaveBeenCalledWith(
      expect.objectContaining({ destinationName: 'Coffee Shop' }),
    );
    expect(useNavigationStore.getState().routePreview).not.toBeNull();
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

  it('pushes staged, rich search results to CarPlay', async () => {
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

    // Local-first pass fires immediately, then the debounced full merge.
    await new Promise((r) => setTimeout(r, 300));

    // The local-only phase is queried first (fast, offline)…
    expect(unifiedSearch).toHaveBeenCalledWith(
      'coffee',
      expect.objectContaining({ localOnly: true }),
    );
    // …then the full staged pipeline for the same query.
    expect(unifiedSearch).toHaveBeenCalledWith('coffee', expect.any(Object));

    const expected = [
      {
        name: 'Coffee Shop',
        subtitle: '0.3 mi · 123 Main St',
        lat: 40.75,
        lng: -73.98,
        kind: 'poi',
      },
      {
        name: 'Tea House',
        subtitle: '0.7 mi · 456 Oak Ave',
        lat: 40.76,
        lng: -73.97,
        kind: 'poi',
      },
    ];
    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith(
      expected,
      'coffee',
      false,
    );
    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith(
      expected,
      'coffee',
      true,
    );
  });

  it('previews navigation to a dashboard favorite', async () => {
    const route = makeRoute();
    (computeRoute as jest.Mock).mockResolvedValue([route]);
    (getFavorites as jest.Mock).mockReturnValue([
      {
        id: 'work',
        kind: 'work',
        label: 'Work',
        entry: { lat: 40.7, lng: -73.9, text: 'Office' },
      },
    ]);

    initCarPlay();
    fireEvent('carPlayConnected');
    fireEvent('carPlayDashboardFavorite', { kind: 'work' });
    await new Promise((r) => setTimeout(r, 10));

    expect(computeRoute).toHaveBeenCalledWith(
      expect.arrayContaining([{ lat: 40.7, lng: -73.9 }]),
      'auto',
      expect.objectContaining({ alternates: 2 }),
    );
    expect(useNavigationStore.getState().routePreview).not.toBeNull();
    expect(NativeModules.PolarisCarPlay.showTripPreview).toHaveBeenCalledWith(
      expect.objectContaining({ destinationName: 'Work' }),
    );
  });

  it('pushes saved places as home suggestions on connect', async () => {
    (getFavorites as jest.Mock).mockReturnValue([
      {
        id: 'home',
        kind: 'home',
        label: 'Home',
        entry: {
          id: 1,
          text: '1 Main St, Town',
          type: 'address',
          housenumber: '1',
          street: 'Main St',
          city: 'Town',
          state: null,
          postcode: null,
          country: null,
          lat: 40.7,
          lng: -73.9,
        },
      },
    ]);

    initCarPlay();
    fireEvent('carPlayConnected');
    await new Promise((r) => setTimeout(r, 0));

    // Pinned/Recents live in the floating map panel, not the search template.
    expect(NativeModules.PolarisCarPlay.updateHomeSuggestions).toHaveBeenCalledWith([
      {
        name: 'Home',
        subtitle: 'Close by',
        lat: 40.7,
        lng: -73.9,
        kind: 'home',
        section: 'pinned',
      },
    ]);

    // An empty query clears the search list so the keyboard isn't covering it.
    fireEvent('searchQuery', { query: '' });
    await new Promise((r) => setTimeout(r, 0));
    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith([], '', true);
    expect(unifiedSearch).not.toHaveBeenCalled();
  });

  it('pushes pinned and recent places as home suggestions on connect', async () => {
    (getFavorites as jest.Mock).mockReturnValue([
      {
        id: 'home',
        kind: 'home',
        label: 'Home',
        entry: { lat: 40.7, lng: -73.9, text: '1 Main St' },
      },
      {
        id: 'work',
        kind: 'work',
        label: 'Work',
        entry: { lat: 40.71, lng: -73.91, text: '2 Office Rd' },
      },
    ]);
    (getSearchHistory as jest.Mock).mockReturnValue([
      {
        entry: { id: 9, text: '31 Bretton Rd', lat: 40.72, lng: -73.92, city: 'Town', state: 'NY' },
        query: 'bretton',
      },
    ]);

    initCarPlay();
    fireEvent('carPlayConnected');
    await new Promise((r) => setTimeout(r, 0));

    expect(NativeModules.PolarisCarPlay.updateHomeSuggestions).toHaveBeenCalledWith([
      {
        name: 'Home',
        subtitle: 'Close by',
        lat: 40.7,
        lng: -73.9,
        kind: 'home',
        section: 'pinned',
      },
      {
        name: 'Work',
        subtitle: '2 Office Rd',
        lat: 40.71,
        lng: -73.91,
        kind: 'work',
        section: 'pinned',
      },
      {
        name: '31 Bretton Rd',
        subtitle: 'Town, NY',
        lat: 40.72,
        lng: -73.92,
        kind: 'recent',
        section: 'recent',
      },
    ]);
    expect(unifiedSearch).not.toHaveBeenCalled();
  });

  it('shows a trip preview when a search result is selected', async () => {
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
      expect.objectContaining({ alternates: 2 }),
    );
    // Preview, not navigation: the driver picks a route and taps Go.
    expect(useNavigationStore.getState().routePreview).not.toBeNull();
    expect(useNavigationStore.getState().isNavigating).toBe(false);
    expect(NativeModules.PolarisCarPlay.showTripPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Coffee Shop',
        destinationLat: 40.75,
        destinationLng: -73.98,
        routes: expect.arrayContaining([
          expect.objectContaining({ encodedPolyline: route.geometry }),
        ]),
      }),
    );
    expect(NativeModules.PolarisCarPlay.startNavigation).not.toHaveBeenCalled();
  });

  it('starts the selected route when the driver taps Go in the preview', async () => {
    const route = makeRoute();
    const alternate = {
      ...makeRoute(),
      geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`B',
    };
    (computeRoute as jest.Mock).mockResolvedValue([route, alternate]);

    initCarPlay();
    fireEvent('carPlayConnected');
    fireEvent('searchResultSelected', { name: 'Coffee Shop', lat: 40.75, lng: -73.98 });
    await new Promise((r) => setTimeout(r, 10));
    jest.clearAllMocks();

    fireEvent('carPlayRouteStart', { index: 1 });

    expect(useNavigationStore.getState().isNavigating).toBe(true);
    expect(useNavigationStore.getState().activeRoute).toBe(alternate);
    expect(useNavigationStore.getState().alternateRoutes).toContain(route);
    expect(NativeModules.PolarisCarPlay.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationName: 'Coffee Shop',
        encodedPolyline: alternate.geometry,
      }),
    );
  });

  it('mirrors an existing phone route preview when CarPlay connects', () => {
    const route = makeRoute();
    useNavigationStore
      .getState()
      .setRoutePreview(route, [], { lat: 40.76, lng: -73.97, name: 'Dest' }, 'auto');

    initCarPlay();
    fireEvent('carPlayConnected');

    expect(NativeModules.PolarisCarPlay.showTripPreview).toHaveBeenCalledWith(
      expect.objectContaining({ destinationName: 'Dest', routes: expect.any(Array) }),
    );
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

    expect(NativeModules.PolarisCarPlay.pushSearchResults).toHaveBeenCalledWith([], 'pizza', true);
  });
});
