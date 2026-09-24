/**
 * Unit tests for the fix-driven background refresh coordinator.
 *
 * iOS suspends JS timers when the phone is locked, so the periodic traffic /
 * congestion monitors do not fire. These verify the fix-driven fallback runs
 * only while backgrounded, and only with an active route.
 */

let mockAppState = 'active';
jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppState;
    },
  },
}));

const mockRefresh = jest.fn();
const mockCongestionCheck = jest.fn();
jest.mock('../../src/services/traffic/trafficFlowService', () => ({
  refreshRouteTrafficIfStale: (...args: unknown[]) => mockRefresh(...args),
}));
jest.mock('../../src/services/traffic/rerouteService', () => ({
  runCongestionCheckIfDue: (...args: unknown[]) => mockCongestionCheck(...args),
}));

import type { ValhallaRoute } from '../../src/models/route';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import {
  initFixDrivenRefresh,
  teardownFixDrivenRefresh,
} from '../../src/services/navigation/fixDrivenRefresh';

const ROUTE = {
  summary: { distanceMeters: 1000, durationSeconds: 600, hasToll: false, hasFerry: false },
  legs: [],
  geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
} as unknown as ValhallaRoute;

function feedFix(): void {
  useNavigationTrackingStore.getState().setNavPosition([-74.0, 40.7]);
}

beforeEach(() => {
  jest.clearAllMocks();
  teardownFixDrivenRefresh();
  mockAppState = 'active';
  useNavigationStore.setState({ isNavigating: false, activeRoute: null });
  useNavigationTrackingStore.getState().setNavPosition(null);
});

afterEach(() => {
  teardownFixDrivenRefresh();
  useNavigationStore.setState({ isNavigating: false, activeRoute: null });
  useNavigationTrackingStore.getState().setNavPosition(null);
});

describe('fixDrivenRefresh', () => {
  it('refreshes traffic + congestion on a fix while the phone is backgrounded', () => {
    useNavigationStore.setState({ isNavigating: true, activeRoute: ROUTE });
    initFixDrivenRefresh();
    mockAppState = 'background';

    feedFix();

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(Array.isArray(mockRefresh.mock.calls[0][0])).toBe(true);
    expect(mockCongestionCheck).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the app is active (the screen hook owns refresh)', () => {
    useNavigationStore.setState({ isNavigating: true, activeRoute: ROUTE });
    initFixDrivenRefresh();
    mockAppState = 'active';

    feedFix();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockCongestionCheck).not.toHaveBeenCalled();
  });

  it('does nothing when no route is active', () => {
    initFixDrivenRefresh();
    mockAppState = 'background';

    feedFix();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockCongestionCheck).not.toHaveBeenCalled();
  });

  it('stops refreshing after teardown', () => {
    useNavigationStore.setState({ isNavigating: true, activeRoute: ROUTE });
    initFixDrivenRefresh();
    mockAppState = 'background';
    teardownFixDrivenRefresh();

    feedFix();

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockCongestionCheck).not.toHaveBeenCalled();
  });
});
