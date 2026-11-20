/**
 * Preview ↔ navigation ETA parity.
 *
 * Regression for a whole class of "our directions say 14 min but navigation
 * says 11" reports. The preview header reads
 * `routePreviewTrafficEta ?? summary.durationSeconds` while the driving HUD
 * reads `trafficEtaSeconds`, which `useTrafficEta` fills from the local segment
 * model. When the provider ETA was skipped (saved weekday flow already covered
 * the route) nothing set `routePreviewTrafficEta`, so the preview showed the
 * router's traffic-free duration and navigation swapped in a second, different
 * answer for the same road.
 *
 * The fixture is a real Valhalla response for Roosevelt Field → 3309 Merrick
 * Rd, Wantagh NY (11.82 mi, 19.2 min traffic-free), reduced to the shape the app
 * stores. On that route the road-class model priced ~11 mi of parkway at the
 * 70 mph motorway default while Valhalla's own per-edge speeds were 43–47 mph,
 * so navigation claimed 11 min for a 19 min drive.
 */

import type { ValhallaRoute } from '../../src/models/route';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { useTrafficStore } from '../../src/stores/trafficStore';
import { decodePolyline } from '../../src/utils/polyline';
import { seedRoutePreviewTrafficEta } from '../../src/services/traffic/routePreviewEta';
import { computeRouteTrafficEta, trafficMatchRatio } from '../../src/utils/etaCalculator';

import fixture from '../fixtures/valhallaLongIslandParkwayRoute.json';

const route = fixture as ValhallaRoute;
const destination = { lat: 40.6673, lng: -73.5088, name: '3309 Merrick Road' };

function resetStores(): void {
  useNavigationStore.getState().stopNavigation();
  useNavigationStore.getState().clearRoutePreview();
  useTrafficStore.setState({ normalizedSegments: [] });
}

/**
 * A 50% slowdown along the whole route, expressed as a congestion ratio so each
 * probe is measured against its own road (a 10 mph parking-lot stretch and a
 * 47 mph parkway both halve).
 */
function congestedSegmentsAlongRoute(): NormalizedTrafficSegment[] {
  const coords = decodePolyline(route.geometry);
  const now = Math.floor(Date.now() / 1000);
  const segments: NormalizedTrafficSegment[] = [];
  // Every 3rd vertex: a realistic probe density along this route (≈90% of the
  // route's shape matches a reading).
  for (let i = 0; i < coords.length; i += 3) {
    segments.push({
      id: `probe:${i}`,
      coordinates: [coords[i]],
      currentSpeedMph: 0,
      freeFlowSpeedMph: 0,
      congestionRatio: 0.5,
      confidence: 0.9,
      source: 'p2p',
      timestamp: now,
    });
  }
  return segments;
}

beforeEach(resetStores);

describe('preview / navigation ETA parity', () => {
  it('prices the route from the router per-edge speeds, not the road-class table', () => {
    const result = computeRouteTrafficEta(route, []);
    const routerMinutes = route.summary.durationSeconds / 60;
    const localMinutes = result.totalSeconds / 60;

    // Nothing matched, so the local model must reproduce the router's own
    // traffic-free estimate — this is what the preview has always shown.
    expect(trafficMatchRatio(result)).toBe(0);
    expect(localMinutes).toBeGreaterThan(routerMinutes * 0.9);
    expect(localMinutes).toBeLessThan(routerMinutes * 1.1);

    // The old failure: ~11 min against the router's 19.2.
    expect(localMinutes).toBeGreaterThan(15);
  });

  it('shows the same number in the preview and in navigation with no traffic data', () => {
    const nav = useNavigationStore.getState();

    nav.setRoutePreview(route, [], destination, 'auto');
    const seeded = seedRoutePreviewTrafficEta(route);

    const previewSeconds = useNavigationStore.getState().routePreviewTrafficEta;
    expect(previewSeconds).not.toBeNull();
    expect(useNavigationStore.getState().routePreviewTrafficMatchRatio).toBe(0);
    expect(seeded.matchRatio).toBe(0);

    useNavigationStore.getState().startNavigation(route, [], destination, 'auto');
    const state = useNavigationStore.getState();

    // The number the driver accepted is the number they are then shown: same
    // computed seconds carried across the handoff, not two separate estimates.
    expect(state.trafficEtaSeconds).toBe(previewSeconds);
    // CarPlay renders trafficEtaSeconds × remaining fraction; at the start of
    // the trip the fraction is 1, so it renders exactly this.
    expect(state.remainingDistanceMeters).toBe(route.summary.distanceMeters);

    // And it does not claim to be traffic-aware when nothing matched.
    expect(state.trafficMatchRatio).toBe(0);
  });

  it('reflects live congestion in the preview when the device has traffic data', () => {
    useTrafficStore.setState({ normalizedSegments: congestedSegmentsAlongRoute() });

    const freeFlow = computeRouteTrafficEta(route, []);
    useNavigationStore.getState().setRoutePreview(route, [], destination, 'auto');
    const seeded = seedRoutePreviewTrafficEta(route);

    const previewSeconds = useNavigationStore.getState().routePreviewTrafficEta!;
    expect(seeded.matchRatio).toBeGreaterThan(0.5);
    expect(useNavigationStore.getState().routePreviewTrafficMatchRatio).toBeGreaterThan(0.5);
    // A uniform halving of speed: a substantial, measured slowdown.
    expect(previewSeconds).toBeGreaterThan(freeFlow.totalSeconds * 1.4);
    // Still bounded by the safety cap (4× free flow).
    expect(previewSeconds).toBeLessThanOrEqual(freeFlow.totalSeconds * 4 + 1);
  });

  it('clears the seeded ETA when a new preview replaces the route', () => {
    useNavigationStore.getState().setRoutePreview(route, [], destination, 'auto');
    seedRoutePreviewTrafficEta(route);
    expect(useNavigationStore.getState().routePreviewTrafficEta).not.toBeNull();

    useNavigationStore.getState().setRoutePreview(route, [], destination, 'auto');
    expect(useNavigationStore.getState().routePreviewTrafficEta).toBeNull();
    expect(useNavigationStore.getState().routePreviewTrafficMatchRatio).toBeNull();
  });
});
