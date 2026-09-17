jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { useNavigationStore } from '../../src/stores/navigationStore';
import type { ValhallaRoute } from '../../src/models/route';

function makeRoute(id: string, durationSeconds: number): ValhallaRoute {
  return {
    summary: { durationSeconds, distanceMeters: 8000, hasToll: false, hasHighway: false },
    geometry: `geom-${id}`,
    legs: [{ maneuvers: [{ type: 'start', instruction: `go ${id}` }] }],
    boundingBox: undefined,
  } as unknown as ValhallaRoute;
}

const primary = makeRoute('primary', 600);
const alt = makeRoute('alt', 720);
const destination = { lat: 40, lng: -74, name: 'Dest' };

beforeEach(() => {
  useNavigationStore.getState().stopNavigation();
});

describe('navigation alternatives', () => {
  it('carries alternates into active navigation', () => {
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', []);

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(primary);
    expect(state.alternateRoutes).toEqual([alt]);
  });

  it('switches to an alternate and keeps the old route selectable', () => {
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', []);

    useNavigationStore.getState().switchToAlternate(alt);

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(alt);
    expect(state.alternateRoutes).toContain(primary);
    expect(state.currentStepIndex).toBe(0);
    expect(state.currentLegIndex).toBe(0);
    expect(state.etaSeconds).toBe(alt.summary.durationSeconds);
  });

  it('ignores switching to the already-active route', () => {
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', []);
    useNavigationStore.getState().switchToAlternate(primary);
    expect(useNavigationStore.getState().activeRoute).toBe(primary);
  });

  it('clears stale alternates on reroute (replaceRoute)', () => {
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', []);
    useNavigationStore.getState().replaceRoute(makeRoute('reroute', 500));
    expect(useNavigationStore.getState().alternateRoutes).toEqual([]);
  });

  it('clears alternates when navigation stops', () => {
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', []);
    useNavigationStore.getState().stopNavigation();
    expect(useNavigationStore.getState().alternateRoutes).toEqual([]);
  });

  it('preserves waypoints when switching to an alternate mid-trip', () => {
    const waypoint = { lat: 39.5, lng: -75.0, name: 'Stop' };
    useNavigationStore.getState().startNavigation(primary, [alt], destination, 'auto', [waypoint]);

    useNavigationStore.getState().switchToAlternate(alt);

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(alt);
    expect(state.waypoints).toEqual([waypoint]);
    expect(state.currentLegIndex).toBe(0);
  });
});
