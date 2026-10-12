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

const primary = makeRoute('primary', 900);
const faster = makeRoute('faster', 600);
const destination = { lat: 40, lng: -74, name: 'Dest' };

beforeEach(() => {
  useNavigationStore.getState().stopNavigation();
});

describe('faster-route suggestion', () => {
  it('stores the suggestion without changing the active route', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().suggestFasterRoute(faster, 300);

    const state = useNavigationStore.getState();
    expect(state.fasterRouteSuggestion).toEqual({ route: faster, savingSeconds: 300 });
    expect(state.activeRoute).toBe(primary);
  });

  it('accepting adopts the route and clears the suggestion', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().suggestFasterRoute(faster, 300);

    useNavigationStore.getState().acceptFasterRoute();

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(faster);
    expect(state.fasterRouteSuggestion).toBeNull();
    expect(state.etaSeconds).toBe(faster.summary.durationSeconds);
  });

  it('dismissing keeps the active route and clears the suggestion', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().suggestFasterRoute(faster, 300);

    useNavigationStore.getState().dismissFasterRoute();

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(primary);
    expect(state.fasterRouteSuggestion).toBeNull();
  });

  it('accepting with no suggestion is a no-op', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().acceptFasterRoute();
    expect(useNavigationStore.getState().activeRoute).toBe(primary);
  });

  it('clears the suggestion when the route is replaced for another reason', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().suggestFasterRoute(faster, 300);

    useNavigationStore.getState().replaceRoute(makeRoute('other', 500));

    expect(useNavigationStore.getState().fasterRouteSuggestion).toBeNull();
  });

  it('clears the suggestion when navigation stops', () => {
    useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
    useNavigationStore.getState().suggestFasterRoute(faster, 300);

    useNavigationStore.getState().stopNavigation();

    expect(useNavigationStore.getState().fasterRouteSuggestion).toBeNull();
  });
});
