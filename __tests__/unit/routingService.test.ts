/**
 * Regression tests for routingService fallback behaviour.
 *
 * Ensures that computeRoute() and reroute() gracefully fall back between
 * the native (on-device) Valhalla engine, the online HTTP API, and
 * Apple's MapKit MKDirections (iOS only) when earlier tiers fail.
 */

// ── Mock factories ─────────────────────────────────────────────────────────

import { decodePolyline, encodePolyline } from '../../src/utils/polyline';

const mockNativeComputeRoute = jest.fn();
const mockNativeReroute = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);
const mockDispose = jest.fn().mockResolvedValue(undefined);
const mockIsOnline = jest.fn().mockReturnValue(true);
const mockFetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;

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

jest.mock('../../src/services/regions/connectivityService', () => ({
  isOnline: (...args: unknown[]) => mockIsOnline(...args),
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

function validMapKitRoute() {
  return {
    summary: { distanceMeters: 1500, durationSeconds: 120, hasToll: false, hasFerry: false },
    legs: [{ distanceMeters: 1500, durationSeconds: 120, maneuvers: [] }],
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

function mockMapKitSuccess() {
  mockMapKitComputeRoute.mockResolvedValue([validMapKitRoute()]);
  mockMapKitReroute.mockResolvedValue(validMapKitRoute());
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

// ── Tests ──────────────────────────────────────────────────────────────────

// We use jest.isolateModules to get a fresh module instance (with reset
// `initialized` flag) for each test group that needs it.
function loadRoutingService() {
  let mod: typeof import('../../src/services/routing/routingService');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../src/services/routing/routingService');
  });
  return mod!;
}

describe('routingService fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOnline.mockReturnValue(true);
    mockInitialize.mockResolvedValue(undefined);
    mockMapKitAvailable.mockReturnValue(true);
    global.fetch = mockFetchImpl;
  });

  // ── computeRoute ──────────────────────────────────────────────────────

  describe('computeRoute', () => {
    it('uses native engine when initialized and it succeeds', async () => {
      const svc = loadRoutingService();
      const nativeRoute = {
        summary: {
          distance_meters: 1500,
          duration_seconds: 120,
          has_toll: false,
          has_ferry: false,
        },
        legs: [{ distance_meters: 1500, duration_seconds: 120, maneuvers: [] }],
        geometry: 'abc',
        bounding_box: [-74, 40.7, -73.9, 40.8],
      };
      mockNativeComputeRoute.mockResolvedValue([nativeRoute]);

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitComputeRoute).not.toHaveBeenCalled();
      expect(routes).toHaveLength(1);
    });

    it('falls back to online when native engine throws', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOnlineSuccess();

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitComputeRoute).not.toHaveBeenCalled();
      expect(routes).toHaveLength(1);
    });

    it('falls back to MapKit when both native and online fail', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOnlineFailure();
      mockMapKitSuccess();

      await svc.initRouting('/tiles/');
      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitComputeRoute).toHaveBeenCalledTimes(1);
      expect(routes).toHaveLength(1);
    });

    it('throws native error when all three tiers fail', async () => {
      const svc = loadRoutingService();
      mockNativeComputeRoute.mockRejectedValue(new Error('Route outside tile coverage'));
      mockOnlineFailure();
      mockMapKitFailure();

      await svc.initRouting('/tiles/');

      await expect(svc.computeRoute(waypoints, 'auto')).rejects.toThrow(
        'Route outside tile coverage',
      );
    });

    it('uses online when native is not initialized', async () => {
      const svc = loadRoutingService();
      mockOnlineSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockNativeComputeRoute).not.toHaveBeenCalled();
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitComputeRoute).not.toHaveBeenCalled();
      expect(routes).toHaveLength(1);
    });

    it('falls back to MapKit when online fails and native not initialized', async () => {
      const svc = loadRoutingService();
      mockOnlineFailure();
      mockMapKitSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitComputeRoute).toHaveBeenCalledTimes(1);
      expect(routes).toHaveLength(1);
    });

    it('falls back to MapKit when offline and native not initialized', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitSuccess();

      const routes = await svc.computeRoute(waypoints, 'auto');

      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitComputeRoute).toHaveBeenCalledTimes(1);
      expect(routes).toHaveLength(1);
    });

    it('throws when offline, native not initialized, and MapKit unavailable', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitAvailable.mockReturnValue(false);

      await expect(svc.computeRoute(waypoints, 'auto')).rejects.toThrow(
        'No offline routing data and no internet connection.',
      );
    });

    it('rethrows native error when offline and native fails (MapKit unavailable)', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitAvailable.mockReturnValue(false);
      mockNativeComputeRoute.mockRejectedValue(new Error('Tile corruption'));

      await svc.initRouting('/tiles/');

      await expect(svc.computeRoute(waypoints, 'auto')).rejects.toThrow('Tile corruption');
      expect(mockFetchImpl).not.toHaveBeenCalled();
    });
  });

  // ── reroute ───────────────────────────────────────────────────────────

  describe('reroute', () => {
    it('uses native engine when initialized and it succeeds', async () => {
      const svc = loadRoutingService();
      const nativeRoute = {
        summary: {
          distance_meters: 1500,
          duration_seconds: 120,
          has_toll: false,
          has_ferry: false,
        },
        legs: [{ distance_meters: 1500, duration_seconds: 120, maneuvers: [] }],
        geometry: 'abc',
        bounding_box: [-74, 40.7, -73.9, 40.8],
      };
      mockNativeReroute.mockResolvedValue(nativeRoute);

      await svc.initRouting('/tiles/');
      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockNativeReroute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitReroute).not.toHaveBeenCalled();
      expect(route).toBeDefined();
    });

    it('falls back to online when native reroute throws', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockRejectedValue(new Error('No coverage'));
      mockOnlineSuccess();

      await svc.initRouting('/tiles/');
      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockNativeReroute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitReroute).not.toHaveBeenCalled();
      expect(route).toBeDefined();
    });

    it('falls back to MapKit when both native and online reroute fail', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockRejectedValue(new Error('No coverage'));
      mockOnlineFailure();
      mockMapKitSuccess();

      await svc.initRouting('/tiles/');
      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockNativeReroute).toHaveBeenCalledTimes(1);
      expect(mockFetchImpl).toHaveBeenCalled();
      expect(mockMapKitReroute).toHaveBeenCalledTimes(1);
      expect(route).toBeDefined();
    });

    it('throws native error when all three reroute tiers fail', async () => {
      const svc = loadRoutingService();
      mockNativeReroute.mockRejectedValue(new Error('No coverage'));
      mockOnlineFailure();
      mockMapKitFailure();

      await svc.initRouting('/tiles/');

      await expect(svc.reroute(reroutePos, destination, 'auto')).rejects.toThrow('No coverage');
    });

    it('falls back to MapKit when offline and native not initialized', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitSuccess();

      const route = await svc.reroute(reroutePos, destination, 'auto');

      expect(mockFetchImpl).not.toHaveBeenCalled();
      expect(mockMapKitReroute).toHaveBeenCalledTimes(1);
      expect(route).toBeDefined();
    });

    it('throws when offline, native not initialized, and MapKit unavailable', async () => {
      const svc = loadRoutingService();
      mockIsOnline.mockReturnValue(false);
      mockMapKitAvailable.mockReturnValue(false);

      await expect(svc.reroute(reroutePos, destination, 'auto')).rejects.toThrow(
        'No offline routing data and no internet connection.',
      );
    });

    it('routes through via-points and sends the GPS heading on reroute', async () => {
      const svc = loadRoutingService();
      mockOnlineSuccess();

      const via = [{ lat: 40.73, lng: -74.0 }];
      await svc.reroute(reroutePos, destination, 'auto', { via, heading: 90 });

      expect(mockFetchImpl).toHaveBeenCalled();
      const body = JSON.parse(
        (mockFetchImpl.mock.calls[0][1] as { body: string }).body as string,
      ) as { locations: Array<Record<string, unknown>> };
      expect(body.locations).toHaveLength(3);
      expect(body.locations[1]).toMatchObject({ lat: 40.73, lon: -74.0 });
      expect(body.locations[0]).toMatchObject({ heading: 90 });
    });

    it('omits heading from the reroute request when unknown', async () => {
      const svc = loadRoutingService();
      mockOnlineSuccess();

      await svc.reroute(reroutePos, destination, 'auto');

      const body = JSON.parse(
        (mockFetchImpl.mock.calls[0][1] as { body: string }).body as string,
      ) as { locations: Array<Record<string, unknown>> };
      expect(body.locations[0]).not.toHaveProperty('heading');
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
});
