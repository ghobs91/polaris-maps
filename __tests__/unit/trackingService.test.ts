/**
 * Unit tests for the shared turn-by-turn tracking pipeline
 * (src/services/navigation/trackingService.ts).
 *
 * Covers: happy-path fix processing, off-route boundary/counter behavior,
 * reroute triggering + route replacement, premature-step-advance guard,
 * DR no-backwards-jump rule, and speed clamping.
 */

const mockReroute = jest.fn();
jest.mock('../../src/services/routing/routingService', () => ({
  reroute: (...args: unknown[]) => mockReroute(...args),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import type { ValhallaManeuver, ValhallaRoute } from '../../src/models/route';
import { useNavigationStore } from '../../src/stores/navigationStore';
import {
  startTracking,
  processFix,
  stopTracking,
  isTracking,
  getAnchor,
  getGpsSegmentIndex,
  getRouteCoords,
  advanceAlongRoute,
  distToIndex,
} from '../../src/services/navigation/trackingService';
import { haversineMeters } from '../../src/utils/routeSnap';

// ── Fixtures ────────────────────────────────────────────────────────

/** Encode [lng, lat] pairs into a Valhalla precision-6 polyline. */
function encodePolyline(coords: [number, number][], precision = 6): string {
  const factor = Math.pow(10, precision);
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
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
    const latE = Math.round(lat * factor);
    const lngE = Math.round(lng * factor);
    out += enc(latE - prevLat) + enc(lngE - prevLng);
    prevLat = latE;
    prevLng = lngE;
  }
  return out;
}

// A simple ~1.1 km northward route: A -> B.
const A: [number, number] = [-74.0, 40.7];
const B: [number, number] = [-74.0, 40.71];

function makeManeuver(overrides: Partial<ValhallaManeuver> = {}): ValhallaManeuver {
  return {
    type: 'continue',
    instruction: 'Continue',
    distanceMeters: 500,
    durationSeconds: 60,
    beginShapeIndex: 0,
    endShapeIndex: 1,
    ...overrides,
  };
}

function makeRoute(
  coords: [number, number][] = [A, B],
  maneuvers?: ValhallaManeuver[],
): ValhallaRoute {
  return {
    summary: {
      distanceMeters: haversineMeters(coords[0], coords[coords.length - 1]),
      durationSeconds: 600,
      hasToll: false,
      hasFerry: false,
    },
    legs: [
      {
        maneuvers: maneuvers ?? [
          makeManeuver({ type: 'start', beginShapeIndex: 0 }),
          makeManeuver({
            type: 'destination',
            instruction: 'Arrive',
            beginShapeIndex: 1,
            endShapeIndex: 1,
          }),
        ],
        distanceMeters: haversineMeters(coords[0], coords[coords.length - 1]),
        durationSeconds: 600,
      },
    ],
    geometry: encodePolyline(coords),
    boundingBox: [-75, 40, -73, 41],
  };
}

type FixOverrides = Partial<{
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
}>;

function makeFix({
  lat,
  lng,
  speed = 10,
  heading = 0,
}: FixOverrides): Parameters<typeof processFix>[0] {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading,
      speed,
    },
    timestamp: Date.now(),
    mocked: false,
  } as Parameters<typeof processFix>[0];
}

function startNav(route: ValhallaRoute) {
  useNavigationStore.getState().startNavigation(route, [], { lat: B[1], lng: B[0] }, 'auto');
}

// ── Controlled clock ────────────────────────────────────────────────

let nowMs = 1_000_000;
beforeEach(() => {
  jest.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  jest.restoreAllMocks();
  stopTracking();
  useNavigationStore.getState().stopNavigation();
  jest.clearAllMocks();
  nowMs = 1_000_000;
});

// ── Tests ───────────────────────────────────────────────────────────

describe('trackingService — lifecycle', () => {
  it('startTracking decodes the route and activates tracking', () => {
    const route = makeRoute();
    startTracking(route);

    expect(isTracking()).toBe(true);
    expect(getRouteCoords().length).toBe(2);
    expect(getAnchor()).toBeNull();
    expect(getGpsSegmentIndex()).toBe(0);
  });

  it('processFix is a no-op when not tracking', () => {
    processFix(makeFix({ lat: A[1], lng: A[0] }));
    expect(getAnchor()).toBeNull();
  });

  it('stopTracking clears all state', () => {
    startNav(makeRoute());
    startTracking(makeRoute());
    processFix(makeFix({ lat: (A[1] + B[1]) / 2, lng: A[0], speed: 10 }));

    stopTracking();

    expect(isTracking()).toBe(false);
    expect(getAnchor()).toBeNull();
    expect(getGpsSegmentIndex()).toBe(0);
    expect(getRouteCoords()).toEqual([]);
  });
});

describe('trackingService — happy path fix processing', () => {
  it('snaps the fix, sets a DR anchor and updates ETA', () => {
    const route = makeRoute();
    startNav(route);
    startTracking(route);

    // Fix at the midpoint of A->B with valid GPS speed.
    processFix(makeFix({ lat: (A[1] + B[1]) / 2, lng: A[0], speed: 12 }));

    const anchor = getAnchor()!;
    expect(anchor).not.toBeNull();
    expect(anchor.segIdx).toBe(0);
    expect(anchor.speedMps).toBeCloseTo(12, 5);

    const nav = useNavigationStore.getState();
    expect(nav.remainingDistanceMeters).not.toBeNull();
    // Roughly half the route remains (~556 m of ~1112 m).
    expect(nav.remainingDistanceMeters!).toBeGreaterThan(400);
    expect(nav.remainingDistanceMeters!).toBeLessThan(700);
    expect(nav.etaSeconds).toBeGreaterThan(0);
    expect(nav.etaSeconds).toBeLessThan(600);
  });

  it('advances the step when the fix crosses the next maneuver beginShapeIndex', () => {
    // 3-point route so a fix past the midpoint snaps to segment index 1.
    const C: [number, number] = [-74.0, 40.72];
    const route = makeRoute(
      [A, B, C],
      [
        makeManeuver({ type: 'start', beginShapeIndex: 0 }),
        makeManeuver({ type: 'continue', instruction: 'Turn', beginShapeIndex: 1 }),
        makeManeuver({
          type: 'destination',
          instruction: 'Arrive',
          beginShapeIndex: 2,
          endShapeIndex: 2,
        }),
      ],
    );
    startNav(route);
    startTracking(route);
    expect(useNavigationStore.getState().currentStepIndex).toBe(0);

    // Fix beyond C → snapped to segment index 1 (>= maneuver[1].beginShapeIndex).
    processFix(makeFix({ lat: C[1] + 0.001, lng: A[0], speed: 10 }));

    expect(useNavigationStore.getState().currentStepIndex).toBe(1);
  });

  it('does not advance the step while still on an earlier segment', () => {
    const route = makeRoute();
    startNav(route);
    startTracking(route);

    // Fix near A → segment index 0 (< destination beginShapeIndex 1).
    processFix(makeFix({ lat: A[1] + 0.0001, lng: A[0], speed: 10 }));

    expect(useNavigationStore.getState().currentStepIndex).toBe(0);
  });
});

describe('trackingService — off-route detection & rerouting', () => {
  function farOffRouteFix(): Parameters<typeof processFix>[0] {
    // Well over OFF_ROUTE_THRESHOLD_METERS (50 m) east of the route.
    return makeFix({ lat: A[1], lng: A[0] + 0.01, speed: 10 });
  }

  it('requires consecutive off-route readings before rerouting', () => {
    startNav(makeRoute());
    startTracking(makeRoute());
    mockReroute.mockResolvedValue(makeRoute());

    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    expect(mockReroute).not.toHaveBeenCalled();

    // A single on-route reading resets the counter.
    processFix(makeFix({ lat: (A[1] + B[1]) / 2, lng: A[0], speed: 10 }));
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    expect(mockReroute).not.toHaveBeenCalled();
  });

  it('triggers reroute on the third consecutive off-route reading and replaces the route', async () => {
    startNav(makeRoute());
    startTracking(makeRoute());

    const newRoute = makeRoute([
      [A[0] + 0.01, A[1]],
      [A[0] + 0.01, B[1]],
    ]);
    mockReroute.mockResolvedValue(newRoute);

    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());

    expect(mockReroute).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // flush .then

    const nav = useNavigationStore.getState();
    expect(nav.isRerouting).toBe(false);
    // replaceRoute clears transient deviation flags (matches screen behaviour).
    expect(nav.hasDeviated).toBe(false);
    expect(nav.activeRoute).toBe(newRoute);
    expect(mockReroute.mock.calls[0][2]).toBe('auto'); // costing forwarded
    // Anchor reset to start of new route; tracker adopted the new geometry.
    expect(getGpsSegmentIndex()).toBe(0);
    expect(getRouteCoords()[0]).toEqual([A[0] + 0.01, A[1]]);
    expect(getAnchor()!.pos).toEqual([A[0] + 0.01, A[1]]);
  });

  it('clears the rerouting flag when the reroute request fails', async () => {
    startNav(makeRoute());
    startTracking(makeRoute());
    mockReroute.mockRejectedValue(new Error('offline'));

    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    await Promise.resolve();
    await Promise.resolve(); // flush .catch

    expect(useNavigationStore.getState().isRerouting).toBe(false);
    // The off-route counter survives a failed attempt (matches screen
    // behaviour), so the very next far fix retries the reroute immediately.
    mockReroute.mockClear();
    mockReroute.mockResolvedValue(makeRoute());
    processFix(farOffRouteFix());
    await Promise.resolve();
    expect(mockReroute).toHaveBeenCalledTimes(1);
  });

  it('does not trigger overlapping reroutes', async () => {
    startNav(makeRoute());
    startTracking(makeRoute());
    // Never-resolving promise simulates an in-flight request.
    mockReroute.mockReturnValue(new Promise(() => {}));

    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());

    expect(mockReroute).toHaveBeenCalledTimes(1);
  });

  it('skips rerouting when there is no destination', () => {
    startTracking(makeRoute());
    // Navigate without setting a destination.
    useNavigationStore.setState({
      isNavigating: true,
      activeRoute: makeRoute(),
      destination: null,
    });

    processFix(farOffRouteFix());
    processFix(farOffRouteFix());
    processFix(farOffRouteFix());

    expect(mockReroute).not.toHaveBeenCalled();
  });
});

describe('trackingService — dead reckoning rules', () => {
  it('keeps the DR projection when it is ahead of the GPS position (no backwards jump)', () => {
    startNav(makeRoute());
    startTracking(makeRoute());

    // First fix near A moving fast.
    nowMs = 1000;
    processFix(makeFix({ lat: A[1], lng: A[0], speed: 30 }));

    // Advance time so DR projects forward along the route.
    nowMs = 3000; // 2 s at 30 m/s ≈ 60 m ≈ 0.00054° latitude
    processFix(makeFix({ lat: A[1] + 0.0002, lng: A[0], speed: 25 }));

    const anchor = getAnchor()!;
    // The anchor must remain ahead of the GPS-snapped position: DR projected
    // forward along the route, so it moved well past the second fix's latitude.
    expect(anchor.pos[1]).toBeGreaterThan(A[1] + 0.0002);
    expect(anchor.segIdx).toBe(0);
    // Speed adopted from latest GPS fix.
    expect(anchor.speedMps).toBeCloseTo(25, 5);
  });

  it('anchors at the GPS position when it is ahead of the DR projection', () => {
    startNav(makeRoute());
    startTracking(makeRoute());

    // First fix stationary-ish (slow speed → no extrapolation).
    nowMs = 1000;
    processFix(makeFix({ lat: A[1], lng: A[0], speed: 0 }));
    // dt > 0.1 s and speed 0 → estimated speed from displacement; move far north.
    nowMs = 5000;
    processFix(makeFix({ lat: A[1] + 0.005, lng: A[0], speed: 20 }));

    const anchor = getAnchor()!;
    expect(anchor.pos[1]).toBeCloseTo(A[1] + 0.005, 6);
  });

  it('clamps speed to 55 m/s', () => {
    startNav(makeRoute());
    startTracking(makeRoute());

    processFix(makeFix({ lat: (A[1] + B[1]) / 2, lng: A[0], speed: 120 }));

    expect(getAnchor()!.speedMps).toBeLessThanOrEqual(55);
  });

  it('estimates speed from displacement when GPS speed is unavailable', () => {
    startNav(makeRoute());
    startTracking(makeRoute());

    nowMs = 1000;
    processFix(makeFix({ lat: A[1], lng: A[0], speed: null }));
    nowMs = 2000; // 1 s later, moved ~11 m north ≈ 0.0001°
    processFix(makeFix({ lat: A[1] + 0.0001, lng: A[0], speed: null }));

    const anchor = getAnchor()!;
    expect(anchor.speedMps).toBeGreaterThan(0);
    expect(anchor.speedMps).toBeLessThanOrEqual(55);
  });
});

describe('trackingService — polyline helpers', () => {
  beforeEach(() => {
    startTracking(makeRoute([A, B, [-74.0, 40.72]]));
  });

  it('advanceAlongRoute walks the polyline and returns segment indices', () => {
    const [pos, segIdx] = advanceAlongRoute(A, 0, 0);
    expect(pos).toEqual(A);
    expect(segIdx).toBe(0);

    // Walk more than one full segment (each ≈ 1112 m).
    const [pos2, segIdx2] = advanceAlongRoute(A, 0, 2500);
    expect(segIdx2).toBe(2);
    expect(pos2[1]).toBeCloseTo(40.72, 5);
  });

  it('distToIndex sums segments up to the target index', () => {
    const full = haversineMeters(A, B);
    expect(distToIndex(A, 0, 1)).toBeCloseTo(full, -1);
    expect(distToIndex(A, 1, 1)).toBe(0);
  });
});
