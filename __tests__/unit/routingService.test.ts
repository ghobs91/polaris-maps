/**
 * Regression tests for the routing cascade.
 *
 * The cascade is strictly ordered: on-device Valhalla → OSRM → Apple MapKit →
 * FOSSGIS public Valhalla. These tests pin that order (including which tiers
 * must *not* be contacted when an earlier tier answers) and the tier reporting
 * that drives the developer-mode indicator.
 */

import { decodePolyline, encodePolyline } from '../../src/utils/polyline';

// ── Mock factories ─────────────────────────────────────────────────────────

const mockNativeComputeRoute = jest.fn();
const mockNativeReroute = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);
const mockDispose = jest.fn().mockResolvedValue(undefined);
const mockIsOnline = jest.fn().mockReturnValue(true);
const mockFetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;

const mockOsrmComputeRoute = jest.fn();
const mockOsrmSupported = jest.fn().mockReturnValue(true);

const mockMapKitComputeRoute = jest.fn();
const mockMapKitReroute = jest.fn();
const mockMapKitAvailable = jest.fn().mockReturnValue(true);

jest.mock('../../src/native/valhalla', () => ({
  initialize: mockInitialize,
  computeRoute: mockNativeComputeRoute,
  reroute: mockNativeReroute,
  updateTrafficSpeeds: jest.fn(),
  hasCoverage: jest.fn(),
  getLoadedRegions: jest.fn(),
  dispose: mockDispose,
}));

jest.mock('../../src/native/mapkit', () => ({
  isMapKitAvailable: (...args: unknown[]) => mockMapKitAvailable(...args),
  computeRoute: mockMapKitComputeRoute,
  reroute: mockMapKitReroute,
  searchPOI: jest.fn(),
  searchPlace: jest.fn(),
  searchPlaceAll: jest.fn(),
  searchNearby: jest.fn(),
}));

jest.mock('../../src/services/routing/osrmClient', () => ({
  computeOsrmRoute: (...args: unknown[]) => mockOsrmComputeRoute(...args),
  isOsrmSupported: (...args: unknown[]) => mockOsrmSupported(...args),
}));

jest.mock('../../src/services/regions/connectivityService', () => ({
  isOnline: (...args: unknown[]) => mockIsOnline(...args),
  getConnectionQuality: () => 'good',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: () => null },
  NativeModules: {},
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function validValhallaResponse() {
  return {
    trip: {
      legs: [
        {
          maneuvers: [
            {
              type: 1,
              instruction: 'Start on Main St',
              length: 1.5,
              time: 120,
              begin_shape_index: 0,
              end_shape_index: 5,
            },
            {
              type: 4,
              instruction: 'You have arrived',
              length: 0,
              time: 0,
              begin_shape_index: 5,
              end_shape_index: 5,
            },
          ],
          summary: { length: 1.5, time: 120 },
          shape: 'abc',
        },
      ],
      summary: {
        length: 1.5,
        time: 120,
        has_toll: false,
        has_ferry: false,
        min_lon: -74.0,
        min_lat: 40.7,
        max_lon: -73.9,
        max_lat: 40.8,
      },
    },
  };
}

/** Native-shaped route (already normalised by the native module adapter). */
function nativeRoute(distanceMeters = 1500) {
  return {
    summary: {
      distance_meters: distanceMeters,
      duration_seconds: 120,
      has_toll: false,
      has_ferry: false,
    },
    legs: [{ distance_meters: distanceMeters, duration_seconds: 120, maneuvers: [] }],
    geometry: 'abc',
    bounding_box: [-74, 40.7, -73.9, 40.8],
  };
}

/** App-shaped route, as `computeOsrmRoute` returns after normalisation. */
function osrmRoute(distanceMeters = 1111) {
  return {
    summary: { distanceMeters, durationSeconds: 90, hasToll: false, hasFerry: false },
    legs: [{ distanceMeters, durationSeconds: 90, maneuvers: [] }],
    geometry: 'abc',
    boundingBox: [-74, 40.7, -73.9, 40.8],
  };
}

function mapKitRoute(distanceMeters = 2222) {
  return {
    summary: { distanceMeters, durationSeconds: 100, hasToll: false, hasFerry: false },
    legs: [{ distanceMeters, durationSeconds: 100, maneuvers: [] }],
    geometry: 'abc',
    boundingBox: [-74, 40.7, -73.9, 40.8],
  };
}

function mockOnlineSuccess() {
  mockFetchImpl.mockResolvedValue({
    ok: true,
    json: async () => validValhallaResponse(),
  } as unknown as Response);
}

function mockOnlineFailure() {
  mockFetchImpl.mockRejectedValue(new TypeError('Network request failed'));
}

function mockOsrmSuccess(distanceMeters = 1111) {
  mockOsrmComputeRoute.mockResolvedValue([osrmRoute(distanceMeters)]);
}

function mockOsrmFailure() {
  mockOsrmComputeRoute.mockRejectedValue(new Error('OSRM unavailable'));
}

function mockMapKitSuccess() {
  mockMapKitComputeRoute.mockResolvedValue([mapKitRoute()]);
  mockMapKitReroute.mockResolvedValue(mapKitRoute());
}

function mockMapKitFailure() {
  mockMapKitComputeRoute.mockRejectedValue(new Error('MapKit could not find a route.'));
  mockMapKitReroute.mockRejectedValue(new Error('MapKit could not find a route.'));
}

const waypoints = [
  { lat: 40.7128, lng: -74.006 },
  { lat: 40.758, lng: -73.9855 },
];

const reroutePos = { lat: 40.7128, lng: -74.006, bearing: 90 };
const destination = { lat: 40.758, lng: -73.9855 };

// A fresh module instance per test resets the `initialized` flag and the
// last-tier record.
function loadRoutingService() {
  let mod: typeof import('../../src/services/routing/routingService');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../src/services/routing/routingService');
  });
  return mod!;
}

function baseBeforeEach() {
  jest.clearAllMocks();
  mockIsOnline.mockReturnValue(true);
  mockOsrmSupported.mockReturnValue(true);
  mockInitialize.mockResolvedValue(undefined);
  mockMapKitAvailable.mockReturnValue(true);
  global.fetch = mockFetchImpl;
}

describe('routing cascade', () => {
  beforeEach(baseBeforeEach);

  describe('computeRoute', () => {
    it('tier 1: uses the on-device engine and contacts nothing else', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockResolvedValue([nativeRoute()]);

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockOsrmComputeRoute).not.toHaveBeenCalled();
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitComputeRoute).not.toHaveBeenCalled();
      // The mocked native module returns the raw snake_case payload, so this
      // also proves the answer came from the on-device tier untouched.
      expect((routes[0].summary as unknown as { distance_meters: number }).distance_meters).toBe(
        1500,
      );
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'on-device', degraded: false });
    });

    it('tier 2: falls back to OSRM when the on-device engine fails', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOsrmSuccess();

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockOsrmComputeRoute).toHaveBeenCalledTimes(1);
      // Tier 3 must not be touched once OSRM answers.
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitComputeRoute).not.toHaveBeenCalled();
      expect(routes[0].summary.distanceMeters).toBe(1111);
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'osrm', degraded: true });
    });

    it('tier 2: uses OSRM when no region graph is loaded', async () => {
      const svc = loadRoutingService();
      mockOsrmSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).not.toHaveBeenCalled();
      expect(mockOsrmComputeRoute).toHaveBeenCalledTimes(1);
      expect(routes).toHaveLength(1);
    });

    it('tier 3: falls back to MapKit when on-device and OSRM both fail', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOsrmFailure();
      mockMapKitSuccess();

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockMapKitComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(routes[0].summary.distanceMeters).toBe(2222);
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'mapkit', degraded: true });
    });

    it('tier 3: falls back to FOSSGIS Valhalla when everything above fails', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOsrmFailure();
      mockMapKitFailure();
      mockOnlineSuccess();

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockFetchImpl).toHaveBeenCalled();
      expect(routes).toHaveLength(1);
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'fossgis', degraded: true });
    });

    it('skips OSRM for transit, which has no OSRM profile', async () => {
      const svc = loadRoutingService();
      mockOsrmSupported.mockReturnValue(false);
      mockOnlineSuccess();

      const routes = await svc.computeRoute(waypoints, 'transit');

      expect(mockOsrmComputeRoute).not.toHaveBeenCalled();
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(routes).toHaveLength(1);
    });

    it('skips OSRM while offline', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockOsrmComputeRoute).not.toHaveBeenCalled();
      expect(mockMapKitComputeRoute).toHaveBeenCalledTimes(1);
      expect(routes).toHaveLength(1);
    });

    it('throws a cascade error when every tier fails', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOsrmFailure();
      mockMapKitFailure();
      mockOnlineFailure();

      await svc.initRouting('/tiles/');

      await expect(svc.computeRoute(waypoints, 'auto')).rejects.toThrow(
        /Every routing tier failed/,
      );
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'unavailable' });
    });

    it('reports "no data and no connection" when offline without a graph', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitAvailable.mockReturnValue(false);

      await expect(svc.computeRoute(waypoints, 'auto')).rejects.toThrow(
        'No offline routing data and no internet connection.',
      );
    });

    it('notifies tier subscribers when the tier changes', async () => {
      const svc = loadRoutingService();
      const seen: string[] = [];
      const unsubscribe = svc.subscribeRoutingTier(() =>
        seen.push(svc.getRoutingTierState()?.tier ?? 'none'),
      );
      mockOsrmSuccess();

      await svc.computeRoute(waypoints, 'auto');
      unsubscribe();

      expect(seen).toEqual(['osrm']);
    });
  });

  describe('reroute', () => {
    it('tier 1: uses the native reroute fast path', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockResolvedValue(nativeRoute());

      await svc.initRouting('/tiles/');
      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockNativeReroute).toHaveBeenCalledTimes(1);
      expect(mockOsrmComputeRoute).not.toHaveBeenCalled();
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect((route.summary as unknown as { distance_meters: number }).distance_meters).toBe(1500);
      expect(svc.getRoutingTierState()).toMatchObject({ tier: 'on-device' });
    });

    it('routes through via-points on the on-device engine instead of reroute', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockResolvedValue([nativeRoute()]);

      await svc.initRouting('/tiles/');
      await svc.reroute(reroutePos, destination, 'auto', { via: [{ lat: 40.73, lng: -74.0 }] });

      expect(mockNativeReroute).not.toHaveBeenCalled();
      const [pts] = mockNativeComputeRoute.mock.calls[0] as [Array<{ lat: number }>];
      expect(pts).toHaveLength(3);
    });

    it('tier 2: falls back to OSRM when the native reroute fails', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockRejectedValue(new Error('No coverage'));
      mockOsrmSuccess();

      await svc.initRouting('/tiles/');
      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockOsrmComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(route.summary.distanceMeters).toBe(1111);
    });

    it('forwards the crisis heading to the network tiers', async () => {
      const svc = loadRoutingService();
      mockOsrmFailure();
      mockMapKitFailure();
      mockOnlineSuccess();

      await svc.reroute(reroutePos, destination, 'auto', { heading: 90 });

      const body = JSON.parse(
        (mockFetchImpl.mock.calls[0][1] as { body: string }).body as string,
      ) as { locations: Array<Record<string, unknown>> };
      expect(body.locations[0]).toMatchObject({ heading: 90 });
    });

    it('omits heading when unknown', async () => {
      const svc = loadRoutingService();
      mockOsrmFailure();
      mockMapKitFailure();
      mockOnlineSuccess();

      await svc.reroute(reroutePos, destination, 'auto');

      const body = JSON.parse(
        (mockFetchImpl.mock.calls[0][1] as { body: string }).body as string,
      ) as { locations: Array<Record<string, unknown>> };
      expect(body.locations[0]).not.toHaveProperty('heading');
    });

    it('throws when every reroute tier fails', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockRejectedValue(new Error('No coverage'));
      mockOsrmFailure();
      mockMapKitFailure();
      mockOnlineFailure();

      await svc.initRouting('/tiles/');

      await expect(svc.reroute(reroutePos, destination, 'auto')).rejects.toThrow(
        /Every routing tier failed/,
      );
    });
  });

  // ── multi-leg geometry ───────────────────────────────────────────────

  describe('multi-leg routes', () => {
    it('combines per-leg shapes with offset maneuver indices', async () => {
      const svc = loadRoutingService();
      const A = { lat: 40.7, lng: -74.0 };
      const B = { lat: 40.71, lng: -74.0 };
      const C = { lat: 40.72, lng: -74.0 };
      const leg0shape = encodePolyline([
        [A.lng, A.lat],
        [B.lng, B.lat],
      ]);
      const leg1shape = encodePolyline([
        [B.lng, B.lat],
        [C.lng, C.lat],
      ]);
      mockFetchImpl.mockResolvedValue({
        ok: true,
        json: async () => ({
          trip: {
            legs: [
              {
                maneuvers: [
                  {
                    type: 1,
                    instruction: 'Start',
                    length: 1,
                    time: 60,
                    begin_shape_index: 0,
                    end_shape_index: 1,
                  },
                ],
                summary: { length: 1, time: 60 },
                shape: leg0shape,
              },
              {
                maneuvers: [
                  {
                    type: 8,
                    instruction: 'Continue',
                    length: 1,
                    time: 60,
                    begin_shape_index: 0,
                    end_shape_index: 1,
                  },
                ],
                summary: { length: 1, time: 60 },
                shape: leg1shape,
              },
            ],
            summary: {
              length: 2,
              time: 120,
              has_toll: false,
              has_ferry: false,
              min_lon: -74.0,
              min_lat: 40.7,
              max_lon: -74.0,
              max_lat: 40.72,
            },
          },
        }),
      } as unknown as Response);

      const routes = await svc.computeRoute([A, B, C], 'auto');

      expect(routes).toHaveLength(1);
      // Geometry spans both legs (shared via-point deduplicated).
      const pts = decodePolyline(routes[0].geometry);
      expect(pts).toHaveLength(3);
      expect(pts[0][1]).toBeCloseTo(A.lat, 5);
      expect(pts[2][1]).toBeCloseTo(C.lat, 5);
      // Second-leg maneuver indices are offset into the combined shape.
      expect(routes[0].legs[1].maneuvers[0].beginShapeIndex).toBe(1);
      expect(routes[0].legs[1].maneuvers[0].endShapeIndex).toBe(2);
    });
  });

  // ── interchange exit signs ────────────────────────────────────────────

  describe('interchange exit signs', () => {
    function mockExitResponse() {
      mockFetchImpl.mockResolvedValue({
        ok: true,
        json: async () => ({
          trip: {
            legs: [
              {
                maneuvers: [
                  {
                    type: 20,
                    instruction: 'Take the exit on the right toward New York',
                    length: 0.5,
                    time: 30,
                    begin_shape_index: 0,
                    end_shape_index: 1,
                    sign: {
                      exit_number_elements: [{ text: '91B' }],
                      exit_branch_elements: [{ text: 'I 95 North' }],
                      exit_toward_elements: [{ text: 'New York' }],
                      exit_name_elements: [{ text: 'Gettysburg Pike' }],
                    },
                  },
                ],
                summary: { length: 0.5, time: 30 },
                shape: 'abc',
              },
            ],
            summary: {
              length: 0.5,
              time: 30,
              has_toll: false,
              has_ferry: false,
              min_lon: -74.0,
              min_lat: 40.7,
              max_lon: -73.9,
              max_lat: 40.8,
            },
          },
        }),
      } as unknown as Response);
    }

    it('parses the exit number, name, branch, and toward from the sign', async () => {
      const svc = loadRoutingService();
      mockExitResponse();

      const routes = await svc.computeRoute(waypoints, 'auto');
      const maneuver = routes[0].legs[0].maneuvers[0];

      expect(maneuver.exitNumber).toBe('91B');
      expect(maneuver.exitName).toBe('Gettysburg Pike');
      expect(maneuver.exitBranch).toBe('I 95 North');
      expect(maneuver.exitToward).toBe('New York');
    });

    it('leaves exit fields undefined when a maneuver has no sign', async () => {
      const svc = loadRoutingService();
      mockOnlineSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');
      const maneuver = routes[0].legs[0].maneuvers[0];

      expect(maneuver.exitNumber).toBeUndefined();
      expect(maneuver.exitBranch).toBeUndefined();
      expect(maneuver.exitName).toBeUndefined();
      expect(maneuver.exitToward).toBeUndefined();
    });
  });
});

describe('rerouteCandidates', () => {
  beforeEach(baseBeforeEach);

  it('requests alternates from the tier that answers (OSRM here)', async () => {
    const svc = loadRoutingService();
    mockOsrmComputeRoute.mockResolvedValue([osrmRoute(), osrmRoute(1200), osrmRoute(1300)]);

    const routes = await svc.rerouteCandidates(reroutePos, destination, 'auto', {
      heading: 90,
      alternates: 2,
    });

    expect(mockOsrmComputeRoute).toHaveBeenCalledTimes(1);
    const [, , options] = mockOsrmComputeRoute.mock.calls[0] as [
      unknown,
      unknown,
      { alternates?: number; originHeading?: number },
    ];
    expect(options.alternates).toBe(2);
    expect(options.originHeading).toBe(90);
    expect(routes.length).toBeGreaterThan(1);
  });

  it('degrades to a single route when no tier offers alternatives', async () => {
    const svc = loadRoutingService();
    mockIsOnline.mockReturnValue(false);
    mockMapKitSuccess();

    const routes = await svc.rerouteCandidates(reroutePos, destination, 'auto', {
      via: [{ lat: 40.73, lng: -73.99 }],
      alternates: 2,
    });

    expect(routes).toHaveLength(1);
    expect(mockOsrmComputeRoute).not.toHaveBeenCalled();
    expect(mockFetchImpl).not.toHaveBeenCalled();
  });
});
