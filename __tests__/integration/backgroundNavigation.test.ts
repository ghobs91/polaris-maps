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

const mockMmkvStore = new Map<string, boolean>();
jest.mock('../../src/services/storage/mmkv', () => ({
  __esModule: true,
  storage: {
    getBoolean: (key: string) => mockMmkvStore.get(key),
    set: (key: string, value: boolean) => {
      mockMmkvStore.set(key, value);
    },
  },
}));

let mockPlatformOs = 'ios';
jest.mock('react-native', () => ({
  __esModule: true,
  Platform: {
    get OS() {
      return mockPlatformOs;
    },
  },
  Alert: { alert: jest.fn() },
  TurboModuleRegistry: { get: () => null },
  NativeModules: {},
}));

import { Alert } from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TaskManager = require('expo-task-manager');
import {
  BACKGROUND_LOCATION_TASK,
  reconcileStaleBackgroundSession,
  startBackgroundNavSession,
  stopBackgroundNavSession,
} from '../../src/services/navigation/backgroundLocationTask';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import {
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

beforeEach(() => {
  jest.clearAllMocks();
  mockMmkvStore.clear();
  mockPlatformOs = 'ios';
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

    expect(Alert.alert).not.toHaveBeenCalled();
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
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockRequestBackgroundPermissions).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).not.toHaveBeenCalled();
  });

  it('starts the session on a later launch once Always is granted in Settings', async () => {
    mockMmkvStore.set('backgroundNavPermissionRequested', true);
    mockGetBackgroundPermissions.mockResolvedValue(granted());

    const started = await startBackgroundNavSession();

    expect(started).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockStartLocationUpdates).toHaveBeenCalledTimes(1);
  });

  it('falls back without prompting when background permission was previously denied', async () => {
    mockGetBackgroundPermissions.mockResolvedValue(denied());

    const started = await startBackgroundNavSession();

    expect(started).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
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

  it('exits early when navigation is not active', async () => {
    // Not navigating → even valid location data must be ignored.
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
  });

  it('forwards fixes to the pipeline while navigating', async () => {
    // Encode [lng,lat] pairs as a precision-6 polyline (matches utils/polyline).
    const encodePolyline = (coords: [number, number][]): string => {
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
    };

    const route = {
      summary: { distanceMeters: 1112, durationSeconds: 600, hasToll: false, hasFerry: false },
      legs: [
        {
          maneuvers: [
            {
              type: 'start',
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
      boundingBox: [-74, 40.7, -73.9, 40.8],
    };

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
});
