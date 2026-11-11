/**
 * Tests for the tier-2 OSRM client: request shape, OSRM step → app maneuver
 * normalisation, and shape-index continuity into the combined geometry.
 */

import { computeOsrmRoute, isOsrmSupported } from '../../src/services/routing/osrmClient';
import { decodePolyline, encodePolyline } from '../../src/utils/polyline';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
});

const A: [number, number] = [-74.006, 40.7128];
const B: [number, number] = [-74.0, 40.72];
const C: [number, number] = [-73.99, 40.73];

const step0 = encodePolyline([A, B]);
const step1 = encodePolyline([B, C]);

function osrmResponse(overrides: Record<string, unknown> = {}) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: 3000,
        duration: 240,
        bbox: [-74.01, 40.71, -73.98, 40.74],
        legs: [
          {
            distance: 3000,
            duration: 240,
            steps: [
              {
                distance: 1500,
                duration: 120,
                geometry: step0,
                name: 'Main Street',
                maneuver: { type: 'depart', bearing_after: 90, location: A },
                intersections: [{}],
              },
              {
                distance: 1500,
                duration: 120,
                geometry: step1,
                name: 'Broadway',
                maneuver: { type: 'turn', modifier: 'right', location: B },
                intersections: [{ classes: ['toll'] }],
              },
              {
                distance: 0,
                duration: 0,
                geometry: encodePolyline([C, C]),
                name: '',
                maneuver: { type: 'arrive', location: C },
              },
            ],
          },
        ],
        ...overrides,
      },
    ],
  };
}

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => '',
  } as unknown as Response;
}

describe('isOsrmSupported', () => {
  it('has no transit profile', () => {
    expect(isOsrmSupported('transit')).toBe(false);
  });

  it.each(['auto', 'pedestrian', 'bicycle'] as const)('supports %s', (costing) => {
    expect(isOsrmSupported(costing)).toBe(true);
  });
});

describe('computeOsrmRoute', () => {
  const waypoints = [
    { lat: 40.7128, lng: -74.006 },
    { lat: 40.73, lng: -73.99 },
  ];

  it('requests polyline6 geometry with steps from the matching profile', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    await computeOsrmRoute(waypoints, 'auto');

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('/route/v1/driving/-74.006,40.7128;-73.99,40.73');
    expect(url).toContain('geometries=polyline6');
    expect(url).toContain('steps=true');
    expect(url).toContain('overview=false');
  });

  it.each([
    ['pedestrian', 'walking'],
    ['bicycle', 'cycling'],
  ] as const)('maps %s to the %s profile', async (costing, profile) => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));
    await computeOsrmRoute(waypoints, costing);
    expect(String(mockFetch.mock.calls[0][0])).toContain(`/route/v1/${profile}/`);
  });

  it('rejects the unsupported transit costing without making a request', async () => {
    await expect(computeOsrmRoute(waypoints, 'transit')).rejects.toThrow(/transit/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends the origin heading as an OSRM bearings constraint', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    await computeOsrmRoute(waypoints, 'auto', { originHeading: 90 });
    const url = decodeURIComponent(String(mockFetch.mock.calls[0][0]));
    expect(url).toContain('bearings=90,60;');
  });

  it('normalises the summary and legs', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    const [route] = await computeOsrmRoute(waypoints, 'auto');

    expect(route.summary).toEqual({
      distanceMeters: 3000,
      durationSeconds: 240,
      hasToll: true,
      hasFerry: false,
    });
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].maneuvers).toHaveLength(3);
    expect(route.boundingBox).toEqual([-74.01, 40.71, -73.98, 40.74]);
  });

  it('maps OSRM maneuver types to the app vocabulary', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    const [route] = await computeOsrmRoute(waypoints, 'auto');
    const types = route.legs[0].maneuvers.map((m) => m.type);

    expect(types).toEqual(['start', 'turn_right', 'destination']);
  });

  it('synthesizes instructions that name the road', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    const [route] = await computeOsrmRoute(waypoints, 'auto');
    const [start, turn] = route.legs[0].maneuvers;

    expect(start.instruction).toBe('Start on Main Street');
    expect(start.verbalPreTransition).toBe('Start on Main Street');
    expect(turn.instruction).toBe('Turn right onto Broadway');
  });

  it('keeps shape indices continuous across steps and drops the joint duplicate', async () => {
    mockFetch.mockResolvedValue(ok(osrmResponse()));

    const [route] = await computeOsrmRoute(waypoints, 'auto');
    const pts = decodePolyline(route.geometry);
    const maneuvers = route.legs[0].maneuvers;

    // A → B → C: the shared B point is stored once.
    expect(pts).toHaveLength(3);
    expect(maneuvers[0].beginShapeIndex).toBe(0);
    expect(maneuvers[0].endShapeIndex).toBe(1);
    expect(maneuvers[1].beginShapeIndex).toBe(1);
    expect(maneuvers[1].endShapeIndex).toBe(2);
    // Every index points inside the geometry route snapping walks.
    for (const maneuver of maneuvers) {
      expect(maneuver.beginShapeIndex).toBeGreaterThanOrEqual(0);
      expect(maneuver.endShapeIndex).toBeLessThan(pts.length);
    }
  });

  it('detects a ferry leg', async () => {
    mockFetch.mockResolvedValue(
      ok({
        code: 'Ok',
        routes: [
          {
            distance: 100,
            duration: 60,
            legs: [
              {
                distance: 100,
                duration: 60,
                steps: [
                  {
                    distance: 100,
                    duration: 60,
                    geometry: step0,
                    name: 'Ferry Route',
                    maneuver: { type: 'depart', location: A },
                    intersections: [{ classes: ['ferry'] }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const [route] = await computeOsrmRoute(waypoints, 'auto');
    expect(route.summary.hasFerry).toBe(true);
    expect(route.legs[0].maneuvers[0].type).toBe('ferry');
  });

  it('returns one route per alternative', async () => {
    const body = osrmResponse();
    mockFetch.mockResolvedValue(
      ok({ code: 'Ok', routes: [...body.routes, ...body.routes, ...body.routes] }),
    );

    const routes = await computeOsrmRoute(waypoints, 'auto', { alternates: 2 });
    expect(routes).toHaveLength(3);
    expect(String(mockFetch.mock.calls[0][0])).toContain('alternatives=2');
  });

  it('throws on a non-Ok response', async () => {
    mockFetch.mockResolvedValue(ok({ code: 'NoRoute', message: 'Impossible route' }));
    await expect(computeOsrmRoute(waypoints, 'auto')).rejects.toThrow(/OSRM returned no route/);
  });

  it('throws on an HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests',
    } as unknown as Response);
    await expect(computeOsrmRoute(waypoints, 'auto')).rejects.toThrow(/OSRM error 429/);
  });

  it('requires two waypoints', async () => {
    await expect(computeOsrmRoute([waypoints[0]], 'auto')).rejects.toThrow(/at least two/);
  });
});
