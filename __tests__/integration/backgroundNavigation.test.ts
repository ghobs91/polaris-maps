/**
 * Integration tests for the iOS background navigation session lifecycle.
 *
 * Covers the background-navigation spec:
 * - start → managed session started with expected options
 * - permission denial / previously denied → session not started (fallback)
 * - stop → session stopped, tracking state cleared
 * - headless task event while not navigating → early exit (no processing)
 * - Android → no-op (behavior unchanged)
 */

// ── Mock factories (hoisted) ────────────────────────────────────────

const mockStartLocationUpdates = jest.fn();
const mockStopLocationUpdates = jest.fn();
const mockHasStartedLocationUpdates = jest.fn().mockResolvedValue(true);
const mockGetForegroundPermissions = jest.fn();
const mockGetBackgroundPermissions = jest.fn();
const mockRequestBackgroundPermissions = jest.fn();

jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { BestForNavigation: 6, High: 5, Balanced: 3 },
  ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 },
  startLocationUpdatesAsync: (...args: unknown[]) => mockStartLocationUpdates(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => mockStopLocationUpdates(...args),
  hasStartedLocationUpdatesAsync: (...args: unknown[]) => mockHasStartedLocationUpdates(...args),
  getForegroundPermissionsAsync: () => mockGetForegroundPermissions(),
  getBackgroundPermissionsAsync: () => mockGetBackgroundPermissions(),
  requestBackgroundPermissionsAsync: () => mockRequestBackgroundPermissions(),
}));

jest.mock('expo-task-manager', () => {
  const definedTasks: Record<string, (body: unknown) => Promise<unknown>> = {};
  return {
    __esModule: true,
    defineTask: (name: string, executor: (body: unknown) => Promise<unknown>) => {
      definedTasks[name] = executor;
    },
    __definedTasks: definedTasks,
  };
});

jest.mock('expo-haptics', () => ({
  __esModule: true,
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('../../src/services/regions/connectivityService', () => ({
  __esModule: true,
  isOnline: jest.fn().mockReturnValue(true),
}));

const mockReroute = jest.fn();
jest.mock('../../src/services/routing/routingService', () => ({
  __esModule: true,
  reroute: (...args: unknown[]) => mockReroute(...args),
}));

const mockMmkvStore = new Map<string, boolean>();
jest.mock('../../src/services/storage/mmkv', () => ({
  __esModule: true,
  storage: {
    getBoolean: (key: string) => mockMmkvStore.get(key),
    getString: () => undefined,
    set: (key: string, value: boolean) => {
      mockMmkvStore.set(key, value);
    },
  },
}));

let mockPlatformOs = 'ios';
let mockAppState = 'background';
jest.mock('react-native', () => ({
  __esModule: true,
  Platform: {
    get OS() {
      return mockPlatformOs;
    },
  },
  AppState: {
    get currentState() {
      return mockAppState;
    },
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Alert: { alert: jest.fn() },
  Linking: { openSettings: jest.fn() },
  TurboModuleRegistry: { get: () => null },
  NativeModules: {},
}));

import { Alert } from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TaskManager = require('expo-task-manager');
import {
  BACKGROUND_LOCATION_TASK,
  reconcileStaleBackgroundSession,
  resetBackgroundSettingsNudge,
  startBackgroundNavSession,
  stopBackgroundNavSession,
} from '../../src/services/navigation/backgroundLocationTask';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import { initNavigationBackgroundSession } from '../../src/services/navigation/backgroundSessionCoordinator';
import {
  getRouteCoords,
  isTracking,
  startTracking,
  stopTracking,
} from '../../src/services/navigation/trackingService';

function granted(status = 'granted') {
  return { granted: true, status, canAskAgain: true };
}
function undetermined() {
  return { granted: false, status: 'undetermined', canAskAgain: true };
}
function denied() {
  return { granted: false, status: 'denied', canAskAgain: false };
}

/** Encode [lng,lat] pairs as a precision-6 polyline (matches utils/polyline). */
function encodePolyline(coords: [number, number][]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let val = v < 0 ? ~(v << 1) : v << 1;
    let chunk = '';
    while (val >= 0x20) {
      chunk += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
      val >>= 5;
    }
    chunk += String.fromCharCode(val + 63);
    return chunk;
  };
  for (const [lng, lat] of coords) {
    const latE = Math.round(lat * 1e6);
    const lngE = Math.round(lng * 1e6);
    out += enc(latE - prevLat) + enc(lngE - prevLng);
    prevLat = latE;
    prevLng = lngE;
  }
  return out;
}

/** A ~1.1 km northward route used by the task-handler tests. */
function makeTrackedRoute() {
  return {
    summary: { distanceMeters: 1112, durationSeconds: 600, hasToll: false, hasFerry: false },
    legs: [
      {
        maneuvers: [
          {
            type: 'start' as const,
            instruction: 'Head north',
            distanceMeters: 1112,
            durationSeconds: 600,
            beginShapeIndex: 0,
            endShapeIndex: 1,
          },
        ],
        distanceMeters: 1112,
        durationSeconds: 600,
      },
    ],
    geometry: encodePolyline([
      [-74.0, 40.7],
      [-74.0, 40.71],
    ]),
    boundingBox: [-74, 40.7, -73.9, 40.8] as [number, number, number, number],
  };
}

/** A fix ~850 m east of the route — well past the off-route threshold. */
function offRouteFix() {
  return {
    coords: { latitude: 40.705, longitude: -73.99, speed: 10, heading: 90 },
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetBackgroundSettingsNudge();
  mockMmkvStore.clear();
  mockPlatformOs = 'ios';
  mockAppState = 'background';
  useNavigationStore.getState().stopNavigation();
  useNavigationTrackingStore.getState().setBackgroundSessionActive(false);
  mockGetForegroundPermissions.mockResolvedValue(granted());
});

describe('background navigation session — start', () => {
  it('starts the session with BestForNavigation options and flips the store flag', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(granted());

    const started = await startBackgroundNavSession();

    expect(started).toBe(true);
    expect(mockStartLocationUpdates).toHaveBeenCalledTimes(1);
    const [taskName, options] = mockStartLocationUpdates.mock.calls[0];
    expect(taskName).toBe(BACKGROUND_LOCATION_TASK);
    expect(options.accuracy).toBeDefined();
    expect(options.pausesUpdatesAutomatically).toBe(false);
    expect(options.showsBackgroundLocationIndicator).toBe(true);
    expect(useNavigationTrackingStore.getState().backgroundSessionActive).toBe(true);
  });

  it('shows an explainer then requests permission when status is undetermined; proceeds on grant', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());
    mockRequestBackgroundPermissions.mockResolvedValue(granted());
    (Alert.alert as jest.Mock).mockImplementation((_title, _message, buttons) =>
      buttons[1].onPress(),
    );

    const started = await startBackgroundNavSession();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockRequestBackgroundPermissions).toHaveBeenCalledTimes(1);
    expect(started).toBe(true);
    expect(mockStartLocationUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not prompt when the explainer is dismissed', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());
    (Alert.alert as jest.Mock).mockImplementation(
      (_title, _message, buttons) => buttons[0].onPress(), // "Not Now"
    );

    const started = await startBackgroundNavSession();

    expect(started).toBe(false);
    expect(mockRequestBackgroundPermissions).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
  });

  it('persists a "Not Now" dismissal and never prompts again on later launches', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());
    (Alert.alert as jest.Mock).mockImplementation(
      (_title, _message, buttons) => buttons[0].onPress(), // "Not Now"
    );

    await startBackgroundNavSession();
    expect(mockMmkvStore.get('backgroundNavExplainerDismissed')).toBe(true);

    // Fresh launch: same undetermined/can-ask-again OS state, no dialog.
    jest.clearAllMocks();
    mockGetForegroundPermissions.mockResolvedValue(granted());
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());

    const started = await startBackgroundNavSession();

    // No second explainer/OS request — but the driver is pointed at Settings
    // once (the OS status stays "undetermined", so locked guidance would
    // otherwise die silently).
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockRequestBackgroundPermissions).not.toHaveBeenCalled();
    expect(started).toBe(false);
  });

  it('asks only once: stays silent after Continue when the OS did not grant Always', async () => {
    // iOS commonly defers the Always grant, leaving status undetermined.
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());
    mockRequestBackgroundPermissions.mockResolvedValue(undetermined());
    (Alert.alert as jest.Mock).mockImplementation((_title, _message, buttons) =>
      buttons[1].onPress(),
    );

    const first = await startBackgroundNavSession();

    expect(first).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockRequestBackgroundPermissions).toHaveBeenCalledTimes(1);
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();

    // Next navigation start: same undetermined OS state, no second dialog.
    jest.clearAllMocks();
    mockGetForegroundPermissions.mockResolvedValue(granted());
    mockGetBackgroundPermissions.mockResolvedValue(undetermined());

    const second = await startBackgroundNavSession();

    expect(second).toBe(false);
    // No second OS request, but the once-per-run Settings nudge fires.
    expect(mockRequestBackgroundPermissions).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('starts the session on a later launch once Always is granted in Settings', async () => {
    mockMmkvStore.set('backgroundNavPermissionRequested', true);
    mockGetBackgroundPermissions.mockResolvedValue(granted());

    const started = await startBackgroundNavSession();

    expect(started).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).toHaveBeenCalledTimes(1);
  });

  it('points at Settings without re-requesting when background permission was previously denied', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(denied());

    const started = await startBackgroundNavSession();

    expect(started).toBe(false);
    // The OS can no longer be asked, so the once-per-run Settings nudge fires.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockRequestBackgroundPermissions).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
  });

  it('requires foreground permission before starting', async () => {
    mockGetForegroundPermissions.mockResolvedValue(denied());
    mockGetBackgroundPermissions.mockResolvedValue(granted());

    const started = await startBackgroundNavSession();

    expect(started).toBe(false);
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
  });
});

describe('background navigation session — stop', () => {
  it('stops a running session and clears the store flag', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(granted());
    await startBackgroundNavSession();
    expect(useNavigationTrackingStore.getState().backgroundSessionActive).toBe(true);

    await stopBackgroundNavSession();

    expect(mockStopLocationUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(useNavigationTrackingStore.getState().backgroundSessionActive).toBe(false);
  });
});

describe('stale session reconciliation (startup)', () => {
  it('stops a zombie OS session when nothing is navigating', async () => {
    mockHasStartedLocationUpdates.mockResolvedValue(true);

    await reconcileStaleBackgroundSession();

    expect(mockHasStartedLocationUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(mockStopLocationUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(useNavigationTrackingStore.getState().backgroundSessionActive).toBe(false);
  });

  it('leaves the session alone when nothing was started', async () => {
    mockHasStartedLocationUpdates.mockResolvedValue(false);

    await reconcileStaleBackgroundSession();

    expect(mockStopLocationUpdates).not.toHaveBeenCalled();
  });

  it('never stops an active navigation session', async () => {
    mockHasStartedLocationUpdates.mockResolvedValue(true);
    useNavigationStore.setState({ isNavigating: true });

    await reconcileStaleBackgroundSession();

    expect(mockStopLocationUpdates).not.toHaveBeenCalled();
  });

  it('is a no-op on Android', async () => {
    mockPlatformOs = 'android';
    mockHasStartedLocationUpdates.mockResolvedValue(true);

    await reconcileStaleBackgroundSession();

    expect(mockHasStartedLocationUpdates).not.toHaveBeenCalled();
    expect(mockStopLocationUpdates).not.toHaveBeenCalled();
  });
});

describe('navigation tracking lifecycle (global coordinator)', () => {
  it('activates the shared pipeline without the navigation screen mounted, and clears it on end', () => {
    // Expo Router bottom tabs are lazy-mounted, so a trip started from CarPlay
    // never mounts the navigation screen. The coordinator must own the
    // pipeline lifecycle so fixes are not silently dropped.
    mockGetBackgroundPermissions.mockResolvedValue(granted());
    initNavigationBackgroundSession();

    const route = makeTrackedRoute();
    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');

    expect(isTracking()).toBe(true);
    expect(getRouteCoords().length).toBeGreaterThanOrEqual(2);

    useNavigationStore.getState().stopNavigation();

    expect(isTracking()).toBe(false);
  });

  it('re-activates the pipeline when the active route is replaced', () => {
    mockGetBackgroundPermissions.mockResolvedValue(granted());
    initNavigationBackgroundSession();

    const route = makeTrackedRoute();
    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');
    const firstGeometry = getRouteCoords();

    const replacement = {
      ...makeTrackedRoute(),
      geometry: encodePolyline([
        [-74.0, 40.7],
        [-73.99, 40.71],
      ]),
    };
    useNavigationStore.getState().replaceRoute(replacement);

    expect(isTracking()).toBe(true);
    expect(getRouteCoords()).not.toEqual(firstGeometry);
  });
});

describe('background navigation task handler', () => {
  function getHandler(): (body: unknown) => Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (TaskManager as any).__definedTasks[BACKGROUND_LOCATION_TASK];
    expect(handler).toBeDefined();
    return handler;
  }

  it('never throws on task errors or malformed payloads', async () => {
    await expect(
      getHandler()({ error: new Error('location unavailable') }),
    ).resolves.toBeUndefined();
    await expect(getHandler()({ data: {} })).resolves.toBeUndefined();
    await expect(getHandler()({ data: { locations: [{}] } })).resolves.toBeUndefined();
    await expect(getHandler()({})).resolves.toBeUndefined();
  });

  it('survives malformed fixes while tracking is active', async () => {
    // '????' decodes to [[0,0],[0,0]] — just enough geometry to activate
    // the pipeline so malformed fixes reach processFix and must be caught.
    startTracking({
      summary: { distanceMeters: 100, durationSeconds: 60, hasToll: false, hasFerry: false },
      legs: [
        {
          maneuvers: [
            {
              type: 'start',
              instruction: 'Head north',
              distanceMeters: 100,
              durationSeconds: 60,
              beginShapeIndex: 0,
              endShapeIndex: 1,
            },
          ],
          distanceMeters: 100,
          durationSeconds: 60,
        },
      ],
      geometry: '????',
      boundingBox: [-1, -1, 1, 1],
    });
    useNavigationStore.setState({ isNavigating: true });

    await expect(
      getHandler()({ data: { locations: [undefined, null, {}] } }),
    ).resolves.toBeUndefined();
    expect(isTracking()).toBe(true);

    stopTracking();
    useNavigationStore.getState().stopNavigation();
  });

  it('stops a zombie session when navigation is not active', async () => {
    // Not navigating → even valid location data must be ignored, and the OS
    // session must be ended so iOS stops relaunching the app for fixes.
    await getHandler()({
      data: {
        locations: [
          {
            coords: { latitude: 40.7, longitude: -74.0, speed: 10, heading: 0 },
            timestamp: Date.now(),
          },
        ],
      },
    });

    // No crash and no tracking state created.
    expect(isTracking()).toBe(false);
    // Zombie self-heal: the running session is stopped.
    expect(mockStopLocationUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(useNavigationTrackingStore.getState().backgroundSessionActive).toBe(false);
  });

  it('does not stop the session while navigating', async () => {
    const route = makeTrackedRoute();
    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');
    startTracking(route);

    await getHandler()({
      data: {
        locations: [
          {
            coords: { latitude: 40.705, longitude: -74.0, speed: 10, heading: 0 },
            timestamp: Date.now(),
          },
        ],
      },
    });

    expect(mockStopLocationUpdates).not.toHaveBeenCalled();
  });

  it('forwards fixes to the pipeline while navigating', async () => {
    const route = makeTrackedRoute();

    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');
    // The navigation screen activates the shared pipeline on mount/start;
    // simulate it here since we're testing headless delivery end-to-end.
    startTracking(route);

    await getHandler()({
      data: {
        locations: [
          {
            coords: { latitude: 40.705, longitude: -74.0, speed: 10, heading: 0 },
            timestamp: Date.now(),
          },
        ],
      },
    });

    // The fix was processed: ETA/remaining distance updated by processFix.
    const nav = useNavigationStore.getState();
    expect(nav.remainingDistanceMeters).not.toBeNull();
    expect(nav.remainingDistanceMeters!).toBeLessThan(route.summary.distanceMeters);
  });

  it('reroutes an off-route fix while the app is in the foreground', async () => {
    mockAppState = 'active';
    const route = makeTrackedRoute();
    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');
    startTracking(route);
    mockReroute.mockResolvedValue(route);

    const fix = offRouteFix();
    await getHandler()({ data: { locations: [fix, fix, fix] } });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockReroute).toHaveBeenCalledTimes(1);
    // The successful reroute replaced the route and cleared the banner flags.
    expect(useNavigationStore.getState().isRerouting).toBe(false);
    expect(useNavigationStore.getState().hasDeviated).toBe(false);
  });

  it('defers the reroute while the app is backgrounded, then reroutes on return', async () => {
    mockAppState = 'background';
    const route = makeTrackedRoute();
    useNavigationStore.getState().startNavigation(route, [], { lat: 40.71, lng: -74.0 }, 'auto');
    startTracking(route);

    const fix = offRouteFix();
    await getHandler()({ data: { locations: [fix, fix, fix] } });

    // No network I/O from headless delivery — only the deviation flag.
    expect(mockReroute).not.toHaveBeenCalled();
    expect(useNavigationStore.getState().hasDeviated).toBe(true);

    // Back in the foreground, the next fix reroutes immediately (the
    // off-route counter is already past the threshold).
    mockAppState = 'active';
    mockReroute.mockResolvedValue(route);
    await getHandler()({ data: { locations: [fix] } });

    expect(mockReroute).toHaveBeenCalledTimes(1);
  });
});
