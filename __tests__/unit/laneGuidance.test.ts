/**
 * Unit tests for Valhalla turn-lane guidance parsing in routingService.
 *
 * Covers: turn_lanes request flag, bitmask lanes for a highway exit
 * (straight/straight/right with the exit lane active), valid-bit fallback,
 * multi-direction tie-breaking by maneuver side, legacy string format,
 * and missing/empty lanes.
 */

const mockNativeComputeRoute = jest.fn();
const mockNativeReroute = jest.fn();
const mockIsOnline = jest.fn().mockReturnValue(true);
const mockFetchImpl = jest.fn() as jest.MockedFunction<typeof fetch>;

jest.mock('../../src/native/valhalla', () => ({
  initialize: jest.fn(),
  computeRoute: mockNativeComputeRoute,
  reroute: mockNativeReroute,
  updateTrafficSpeeds: jest.fn(),
  hasCoverage: jest.fn(),
  getLoadedRegions: jest.fn(),
  dispose: jest.fn(),
}));

jest.mock('../../src/native/mapkit', () => ({
  isMapKitAvailable: () => false,
  computeRoute: jest.fn(),
  reroute: jest.fn(),
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

function loadRoutingService() {
  let mod: typeof import('../../src/services/routing/routingService');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../src/services/routing/routingService');
  });
  return mod!;
}

function responseWithManeuvers(maneuvers: Record<string, unknown>[]) {
  return {
    trip: {
      legs: [
        {
          maneuvers,
          summary: { length: 2.2, time: 300 },
          shape: 'abc',
        },
      ],
      summary: {
        length: 2.2,
        time: 300,
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

function mockOnline(response: unknown) {
  mockFetchImpl.mockResolvedValue({
    ok: true,
    json: async () => response,
  } as unknown as Response);
}

const waypoints = [
  { lat: 40.7128, lng: -74.006 },
  { lat: 40.758, lng: -73.9855 },
];

function baseManeuver(overrides: Record<string, unknown> = {}) {
  return {
    type: 8, // continue
    instruction: 'Continue',
    length: 1.0,
    time: 60,
    begin_shape_index: 0,
    end_shape_index: 5,
    ...overrides,
  };
}

describe('routingService lane guidance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOnline.mockReturnValue(true);
    global.fetch = mockFetchImpl;
  });

  it('requests turn_lanes from the online API', async () => {
    const svc = loadRoutingService();
    mockOnline(responseWithManeuvers([baseManeuver()]));

    await svc.computeRoute(waypoints, 'auto');

    expect(mockFetchImpl).toHaveBeenCalled();
    const body = JSON.parse(String(mockFetchImpl.mock.calls[0][1]?.body ?? '{}'));
    expect(body.turn_lanes).toBe(true);
  });

  it('parses a highway exit: straight/straight/right with the exit lane active', async () => {
    const svc = loadRoutingService();
    mockOnline(
      responseWithManeuvers([
        baseManeuver({
          type: 21, // exit_highway
          instruction: 'Take exit 24 East',
          lanes: [
            { directions: 2 }, // through
            { directions: 2 }, // through
            { directions: 66, active: 64 }, // through + right, exit side active
          ],
        }),
      ]),
    );

    const [route] = await svc.computeRoute(waypoints, 'auto');
    const lanes = route.legs[0].maneuvers[0].laneGuidance;

    expect(lanes).toBeDefined();
    expect(lanes!.laneCount).toBe(3);
    expect(lanes!.laneDirections).toEqual(['straight', 'straight', 'right']);
    expect(lanes!.activeLanes).toEqual([2]);
  });

  it('falls back to valid bits when no lane is marked active', async () => {
    const svc = loadRoutingService();
    mockOnline(
      responseWithManeuvers([
        baseManeuver({
          lanes: [
            { directions: 2, valid: 2 },
            { directions: 64, valid: 0 },
          ],
        }),
      ]),
    );

    const [route] = await svc.computeRoute(waypoints, 'auto');
    const lanes = route.legs[0].maneuvers[0].laneGuidance;

    expect(lanes!.activeLanes).toEqual([0]);
    expect(lanes!.laneDirections).toEqual(['straight', 'right']);
  });

  it('breaks multi-direction ties by maneuver side (left turn prefers left)', async () => {
    const svc = loadRoutingService();
    mockOnline(
      responseWithManeuvers([
        baseManeuver({
          type: 15, // turn_left
          lanes: [{ directions: 10 }], // left (8) + through (2), no hints
        }),
      ]),
    );

    const [route] = await svc.computeRoute(waypoints, 'auto');

    expect(route.legs[0].maneuvers[0].laneGuidance!.laneDirections).toEqual(['left']);
    expect(route.legs[0].maneuvers[0].laneGuidance!.activeLanes).toEqual([]);
  });

  it('still parses the legacy single-string lane shape', async () => {
    const svc = loadRoutingService();
    mockOnline(
      responseWithManeuvers([
        baseManeuver({
          lanes: [
            { direction: 'left', active: true },
            { direction: 'straight', active: false },
          ],
        }),
      ]),
    );

    const [route] = await svc.computeRoute(waypoints, 'auto');
    const lanes = route.legs[0].maneuvers[0].laneGuidance;

    expect(lanes!.laneDirections).toEqual(['left', 'straight']);
    expect(lanes!.activeLanes).toEqual([0]);
  });

  it('leaves laneGuidance undefined when the maneuver has no lanes', async () => {
    const svc = loadRoutingService();
    mockOnline(responseWithManeuvers([baseManeuver(), baseManeuver({ lanes: [] })]));

    const [route] = await svc.computeRoute(waypoints, 'auto');

    expect(route.legs[0].maneuvers[0].laneGuidance).toBeUndefined();
    expect(route.legs[0].maneuvers[1].laneGuidance).toBeUndefined();
  });

  it('maps merge and u-turn bits to display directions', async () => {
    const svc = loadRoutingService();
    mockOnline(
      responseWithManeuvers([
        baseManeuver({
          lanes: [
            { directions: 1024, active: 1024 },
            { directions: 256, active: 256 },
          ],
        }),
      ]),
    );

    const [route] = await svc.computeRoute(waypoints, 'auto');
    const lanes = route.legs[0].maneuvers[0].laneGuidance;

    expect(lanes!.laneDirections).toEqual(['merge_right', 'u_turn']);
    expect(lanes!.activeLanes).toEqual([0, 1]);
  });
});
