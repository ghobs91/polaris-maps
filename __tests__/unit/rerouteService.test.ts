/**
 * Unit tests for the faster-route monitor in rerouteService.
 *
 * The monitor compares traffic-aware candidate routes against the active
 * route's remaining time and surfaces a suggestion — it must never replace the
 * active route itself.
 */

jest.mock('../../src/services/routing/routingService', () => ({
  rerouteCandidates: jest.fn(),
  updateTrafficSpeeds: jest.fn(),
}));
jest.mock('../../src/services/traffic/trafficAggregator', () => ({
  getTrafficSpeedMap: jest.fn(() => ({})),
}));
jest.mock('../../src/services/navigation/trackingService', () => ({
  getRouteCoords: jest.fn(() => []),
}));

import * as routingService from '../../src/services/routing/routingService';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useNavigationTrackingStore } from '../../src/stores/navigationTrackingStore';
import { useTrafficStore } from '../../src/stores/trafficStore';
import {
  runCongestionCheckIfDue,
  stopRerouteMonitor,
  noteFasterRouteDismissed,
} from '../../src/services/traffic/rerouteService';
import { SUGGESTION_TIMEOUT_MS } from '../../src/services/traffic/reroutePolicy';
import type { ValhallaRoute } from '../../src/models/route';

const mockRerouteCandidates = routingService.rerouteCandidates as jest.Mock;

function makeRoute(id: string, durationSeconds: number): ValhallaRoute {
  return {
    summary: { durationSeconds, distanceMeters: 8000, hasToll: false, hasHighway: false },
    geometry: '',
    legs: [{ maneuvers: [] }],
    boundingBox: undefined,
  } as unknown as ValhallaRoute;
}

const destination = { lat: 40, lng: -74, name: 'Dest' };
const active = makeRoute('active', 900);
const NOW = 10_000_000;

function primeNavigation(): void {
  useNavigationStore.setState({
    isNavigating: true,
    activeRoute: active,
    destination,
    etaSeconds: 600,
    remainingDistanceMeters: 8000,
    trafficEtaSeconds: null,
    fasterRouteSuggestion: null,
    isRerouting: false,
    waypoints: [],
    currentLegIndex: 0,
  });
  useNavigationTrackingStore.getState().setNavPosition([-74, 40.7]);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.clearAllMocks();
  stopRerouteMonitor();
  useNavigationStore.getState().stopNavigation();
  useNavigationTrackingStore.getState().setNavPosition(null);
  useTrafficStore.setState({ normalizedSegments: [] });
});

describe('faster-route monitor', () => {
  it('suggests a candidate that saves at least the threshold without swapping the route', async () => {
    primeNavigation();
    mockRerouteCandidates.mockResolvedValue([makeRoute('faster', 420)]); // saves 180s

    runCongestionCheckIfDue(NOW);
    await flush();

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(active);
    expect(state.fasterRouteSuggestion).toEqual({ route: expect.anything(), savingSeconds: 180 });
  });

  it('does not suggest a marginal saving', async () => {
    primeNavigation();
    mockRerouteCandidates.mockResolvedValue([makeRoute('slightly', 500)]); // saves 100s

    runCongestionCheckIfDue(NOW);
    await flush();

    expect(useNavigationStore.getState().fasterRouteSuggestion).toBeNull();
  });

  it('defers when no GPS fix is available', async () => {
    primeNavigation();
    useNavigationTrackingStore.getState().setNavPosition(null);

    runCongestionCheckIfDue(NOW);
    await flush();

    expect(mockRerouteCandidates).not.toHaveBeenCalled();
  });

  it('does nothing when navigation is inactive', async () => {
    useNavigationStore.getState().stopNavigation();

    runCongestionCheckIfDue(NOW);
    await flush();

    expect(mockRerouteCandidates).not.toHaveBeenCalled();
  });

  it('suppresses suggestions inside the dismiss cooldown', async () => {
    primeNavigation();
    mockRerouteCandidates.mockResolvedValue([makeRoute('faster', 420)]);
    noteFasterRouteDismissed();

    runCongestionCheckIfDue(NOW);
    await flush();

    expect(useNavigationStore.getState().fasterRouteSuggestion).toBeNull();
  });

  it('auto-expires the suggestion after the timeout', async () => {
    jest.useFakeTimers();
    try {
      primeNavigation();
      mockRerouteCandidates.mockResolvedValue([makeRoute('faster', 420)]);

      runCongestionCheckIfDue(NOW);
      // Flush the async candidate computation (microtasks only; timers are fake).
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(useNavigationStore.getState().fasterRouteSuggestion).not.toBeNull();

      jest.advanceTimersByTime(SUGGESTION_TIMEOUT_MS + 1);

      expect(useNavigationStore.getState().fasterRouteSuggestion).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('forwards remaining waypoints, preferences, and alternates', async () => {
    primeNavigation();
    const waypoint = { lat: 39.5, lng: -75.0, name: 'Stop' };
    useNavigationStore.setState({ waypoints: [waypoint], currentLegIndex: 0 });
    mockRerouteCandidates.mockResolvedValue([active]);

    runCongestionCheckIfDue(NOW);
    await flush();

    expect(mockRerouteCandidates).toHaveBeenCalledTimes(1);
    const options = mockRerouteCandidates.mock.calls[0][3];
    expect(options.via).toEqual([{ lat: 39.5, lng: -75.0 }]);
    expect(options.alternates).toBe(2);
  });
});
