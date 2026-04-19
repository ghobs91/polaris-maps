jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getBoolean: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useNavigationStore, type Waypoint } from '../../src/stores/navigationStore';
import type { ValhallaRoute } from '../../src/models/route';

// ── Fixtures ────────────────────────────────────────────────────────

function makeRoute(overrides: Partial<ValhallaRoute> = {}): ValhallaRoute {
  return {
    summary: {
      distanceMeters: 10000,
      durationSeconds: 600,
      hasToll: false,
      hasFerry: false,
    },
    legs: [
      {
        maneuvers: [
          {
            type: 'start',
            instruction: 'Head north',
            distanceMeters: 5000,
            durationSeconds: 300,
            beginShapeIndex: 0,
            endShapeIndex: 1,
            verbalPreTransition: 'Head north',
          },
          {
            type: 'destination',
            instruction: 'Arrive at destination',
            distanceMeters: 0,
            durationSeconds: 0,
            beginShapeIndex: 1,
            endShapeIndex: 1,
            verbalPreTransition: 'Arrive',
          },
        ],
        distanceMeters: 5000,
        durationSeconds: 300,
      },
    ],
    geometry: '_p~iF~ps|U',
    boundingBox: [-74, 40.7, -73.9, 40.8],
    ...overrides,
  };
}

function makeMultiLegRoute(): ValhallaRoute {
  return {
    summary: { distanceMeters: 20000, durationSeconds: 1200, hasToll: false, hasFerry: false },
    legs: [
      {
        maneuvers: [
          {
            type: 'start',
            instruction: 'Head north',
            distanceMeters: 5000,
            durationSeconds: 300,
            beginShapeIndex: 0,
            endShapeIndex: 1,
            verbalPreTransition: 'Head north',
          },
          {
            type: 'destination',
            instruction: 'Arrive at Stop 1',
            distanceMeters: 0,
            durationSeconds: 0,
            beginShapeIndex: 1,
            endShapeIndex: 1,
            verbalPreTransition: 'Arrive',
          },
        ],
        distanceMeters: 5000,
        durationSeconds: 300,
      },
      {
        maneuvers: [
          {
            type: 'start',
            instruction: 'Continue east',
            distanceMeters: 10000,
            durationSeconds: 600,
            beginShapeIndex: 1,
            endShapeIndex: 2,
            verbalPreTransition: 'Continue',
          },
          {
            type: 'destination',
            instruction: 'Arrive at destination',
            distanceMeters: 0,
            durationSeconds: 0,
            beginShapeIndex: 2,
            endShapeIndex: 2,
            verbalPreTransition: 'Arrive',
          },
        ],
        distanceMeters: 10000,
        durationSeconds: 600,
      },
    ],
    geometry: '_p~iF~ps|U_ulLnnqC',
    boundingBox: [-74, 40.7, -73.8, 40.9],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  useNavigationStore.getState().stopNavigation();
  useNavigationStore.getState().clearRoutePreview();
});

describe('routePreviewWaypoints', () => {
  it('starts with empty waypoints', () => {
    expect(useNavigationStore.getState().routePreviewWaypoints).toEqual([]);
  });

  it('setRoutePreviewWaypoints stores waypoints', () => {
    const wps: Waypoint[] = [
      { lat: 40.75, lng: -73.99, name: 'Penn Station' },
      { lat: 40.76, lng: -73.98, name: 'Times Square' },
    ];
    useNavigationStore.getState().setRoutePreviewWaypoints(wps);
    expect(useNavigationStore.getState().routePreviewWaypoints).toEqual(wps);
  });

  it('setRoutePreview carries waypoints', () => {
    const route = makeRoute();
    const dest = { lat: 40.8, lng: -73.9, name: 'Destination' };
    const wps: Waypoint[] = [{ lat: 40.75, lng: -73.99, name: 'Stop A' }];

    useNavigationStore.getState().setRoutePreview(route, [], dest, 'auto', wps);

    const s = useNavigationStore.getState();
    expect(s.routePreview).toBe(route);
    expect(s.routePreviewDestination).toEqual(dest);
    expect(s.routePreviewWaypoints).toEqual(wps);
  });

  it('setRoutePreview defaults to empty waypoints when omitted', () => {
    const route = makeRoute();
    const dest = { lat: 40.8, lng: -73.9, name: 'Dest' };

    // Pre-populate waypoints
    useNavigationStore.getState().setRoutePreviewWaypoints([{ lat: 1, lng: 2 }]);
    // Call without waypoints
    useNavigationStore.getState().setRoutePreview(route, [], dest, 'auto');

    expect(useNavigationStore.getState().routePreviewWaypoints).toEqual([]);
  });

  it('clearRoutePreview resets waypoints', () => {
    useNavigationStore.getState().setRoutePreviewWaypoints([{ lat: 40.75, lng: -73.99 }]);
    useNavigationStore.getState().clearRoutePreview();
    expect(useNavigationStore.getState().routePreviewWaypoints).toEqual([]);
  });
});

describe('startNavigation with waypoints', () => {
  it('carries waypoints into active navigation', () => {
    const route = makeMultiLegRoute();
    const dest = { lat: 40.9, lng: -73.8, name: 'Final' };
    const wps: Waypoint[] = [{ lat: 40.75, lng: -73.99, name: 'Stop 1' }];

    useNavigationStore.getState().startNavigation(route, [], dest, 'auto', wps);

    const s = useNavigationStore.getState();
    expect(s.isNavigating).toBe(true);
    expect(s.waypoints).toEqual(wps);
    expect(s.currentLegIndex).toBe(0);
    // Preview should be cleared
    expect(s.routePreview).toBeNull();
    expect(s.routePreviewWaypoints).toEqual([]);
  });

  it('advanceLeg moves to next leg with correct maneuver offset', () => {
    const route = makeMultiLegRoute();
    const dest = { lat: 40.9, lng: -73.8, name: 'Final' };
    const wps: Waypoint[] = [{ lat: 40.75, lng: -73.99, name: 'Stop 1' }];

    useNavigationStore.getState().startNavigation(route, [], dest, 'auto', wps);
    expect(useNavigationStore.getState().currentLegIndex).toBe(0);
    expect(useNavigationStore.getState().currentStepIndex).toBe(0);

    useNavigationStore.getState().advanceLeg();

    const s = useNavigationStore.getState();
    expect(s.currentLegIndex).toBe(1);
    // Maneuver offset = leg 0 maneuver count (2)
    expect(s.currentStepIndex).toBe(2);
    expect(s.currentManeuver?.instruction).toBe('Continue east');
  });

  it('advanceLeg does not advance past last leg', () => {
    const route = makeMultiLegRoute();
    useNavigationStore.getState().startNavigation(route, [], null, 'auto', []);

    useNavigationStore.getState().advanceLeg(); // 0 → 1
    useNavigationStore.getState().advanceLeg(); // 1 → still 1 (no leg 2)

    expect(useNavigationStore.getState().currentLegIndex).toBe(1);
  });

  it('stopNavigation clears waypoints and leg index', () => {
    const route = makeMultiLegRoute();
    useNavigationStore
      .getState()
      .startNavigation(route, [], null, 'auto', [{ lat: 1, lng: 2, name: 'X' }]);

    useNavigationStore.getState().stopNavigation();

    const s = useNavigationStore.getState();
    expect(s.waypoints).toEqual([]);
    expect(s.currentLegIndex).toBe(0);
    expect(s.isNavigating).toBe(false);
  });
});
