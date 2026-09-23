jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    getBoolean: jest.fn(),
  })),
}));

import type { ValhallaRoute } from '../../src/models/route';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import {
  initArrivalCoordinator,
  teardownArrivalCoordinator,
} from '../../src/services/navigation/arrivalCoordinator';

const DESTINATION = { lat: 40.71, lng: -74.0, name: 'Destination' };

function makeRoute(legCount = 1): ValhallaRoute {
  return {
    summary: { distanceMeters: 1000, durationSeconds: 600, hasToll: false, hasFerry: false },
    legs: Array.from({ length: legCount }, () => ({
      distanceMeters: 1000 / legCount,
      durationSeconds: 600 / legCount,
      maneuvers: [
        {
          type: 'start' as const,
          instruction: 'Head north',
          distanceMeters: 1000 / legCount,
          durationSeconds: 600 / legCount,
          beginShapeIndex: 0,
          endShapeIndex: 1,
        },
      ],
    })),
    geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    boundingBox: [-74.01, 40.7, -73.99, 40.72],
  };
}

/** Two consecutive fixes inside the arrival radius (the detector debounces). */
function feedFix(lat: number, lng: number): void {
  useNavigationTrackingStore.getState().setNavPosition([lng, lat]);
  useNavigationTrackingStore.getState().setNavPosition([lng, lat]);
}

beforeEach(() => {
  useNavigationStore.getState().stopNavigation();
  useNavigationTrackingStore.getState().setNavPosition(null);
  initArrivalCoordinator();
});

afterEach(() => {
  teardownArrivalCoordinator();
  useNavigationStore.getState().stopNavigation();
  useNavigationTrackingStore.getState().setNavPosition(null);
});

describe('arrivalCoordinator', () => {
  it('declares destination arrival and auto-ends the trip', () => {
    jest.useFakeTimers();
    try {
      useNavigationStore.getState().startNavigation(makeRoute(), [], DESTINATION, 'auto');
      useNavigationStore.getState().updateEta(0, 20);

      feedFix(DESTINATION.lat, DESTINATION.lng);

      expect(useNavigationStore.getState().hasArrived).toBe(true);
      expect(useNavigationStore.getState().isNavigating).toBe(true);

      // Auto-end after the grace period (setting defaults to true).
      jest.advanceTimersByTime(8000);
      expect(useNavigationStore.getState().isNavigating).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('advances the leg when an intermediate waypoint is reached', () => {
    const waypoint = { lat: 40.705, lng: -74.0, name: 'Stop' };
    useNavigationStore
      .getState()
      .startNavigation(makeRoute(2), [], DESTINATION, 'auto', [waypoint]);

    expect(useNavigationStore.getState().currentLegIndex).toBe(0);
    feedFix(waypoint.lat, waypoint.lng);

    expect(useNavigationStore.getState().currentLegIndex).toBe(1);
    expect(useNavigationStore.getState().hasArrived).toBe(false);
  });

  it('does not declare arrival from a distant fix', () => {
    useNavigationStore.getState().startNavigation(makeRoute(), [], DESTINATION, 'auto');
    useNavigationStore.getState().updateEta(0, 20);

    feedFix(41.5, -74.0);

    expect(useNavigationStore.getState().hasArrived).toBe(false);
  });

  it('clears latched state when navigation ends', () => {
    useNavigationStore.getState().startNavigation(makeRoute(), [], DESTINATION, 'auto');
    useNavigationStore.getState().updateEta(0, 20);
    feedFix(DESTINATION.lat, DESTINATION.lng);
    expect(useNavigationStore.getState().hasArrived).toBe(true);

    useNavigationStore.getState().stopNavigation();

    // A new trip starts clean (no latched arrival, no leftover auto-end).
    useNavigationStore.getState().startNavigation(makeRoute(), [], DESTINATION, 'auto');
    useNavigationStore.getState().updateEta(0, 20);
    feedFix(41.5, -74.0);
    expect(useNavigationStore.getState().hasArrived).toBe(false);
  });
});
