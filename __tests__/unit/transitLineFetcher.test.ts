import {
  isStraightLineGeometry,
  fetchTransitLines,
  __clearTransitLineCache,
} from '../../src/services/transit/transitLineFetcher';
import { fetchAmtrakRoutes } from '../../src/services/transit/amtrakFetcher';
import { findEndpointForCoords } from '../../src/services/transit/otpEndpointRegistry';
import { overpassFetch } from '../../src/services/overpassClient';

// Mock dependencies for the fetchTransitLines integration test
jest.mock('../../src/services/overpassClient', () => ({
  overpassFetch: jest.fn(),
}));

jest.mock('../../src/services/transit/otpEndpointRegistry', () => ({
  findEndpointForCoords: jest.fn(),
}));

jest.mock('../../src/services/transit/mbtaFetcher', () => ({
  fetchMbtaLines: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/transit/tflFetcher', () => ({
  fetchTflLines: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/transit/amtrakFetcher', () => ({
  fetchAmtrakRoutes: jest.fn().mockResolvedValue([]),
}));

describe('isStraightLineGeometry', () => {
  it('returns true for very few points', () => {
    // 3 points — too few to be real track geometry
    expect(
      isStraightLineGeometry([
        [-74.0, 40.7],
        [-73.0, 41.5],
        [-72.0, 42.0],
      ]),
    ).toBe(true);
  });

  it('returns true for long-distance straight-line route (Amtrak-like)', () => {
    // ~350 km NYC→Boston with only 8 points — classic GTFS straight-line shapes
    const coords: [number, number][] = [
      [-74.0, 40.75], // Penn Station NYC
      [-73.99, 40.77],
      [-73.65, 41.0], // Somewhere in CT
      [-72.92, 41.31], // New Haven
      [-72.58, 41.55],
      [-72.1, 41.75],
      [-71.42, 41.83],
      [-71.06, 42.35], // Boston South Station
    ];
    expect(isStraightLineGeometry(coords)).toBe(true);
  });

  it('returns false for short route even with few points', () => {
    // ~2 km shuttle route with 5 points — short enough to be OK
    const coords: [number, number][] = [
      [-74.0, 40.75],
      [-74.001, 40.753],
      [-74.003, 40.756],
      [-74.005, 40.758],
      [-74.008, 40.76],
    ];
    expect(isStraightLineGeometry(coords)).toBe(false);
  });

  it('returns false for dense geometry (real subway line)', () => {
    // Simulate a 10 km subway route with ~200 points (~20 pts/km)
    const coords: [number, number][] = [];
    const startLon = -74.0;
    const startLat = 40.7;
    for (let i = 0; i < 200; i++) {
      // slight curve eastward over ~0.09° of latitude (~10 km)
      const t = i / 199;
      coords.push([startLon + t * 0.05 + Math.sin(t * Math.PI) * 0.005, startLat + t * 0.09]);
    }
    expect(isStraightLineGeometry(coords)).toBe(false);
  });

  it('returns false for dense geometry over a long distance (commuter rail)', () => {
    // ~50 km route with 600 points (~12 pts/km) — real LIRR-like shapes
    const coords: [number, number][] = [];
    for (let i = 0; i < 600; i++) {
      const t = i / 599;
      coords.push([-73.99 + t * 0.45, 40.75 - t * 0.1 + Math.sin(t * 10) * 0.002]);
    }
    expect(isStraightLineGeometry(coords)).toBe(false);
  });

  it('returns true for medium-distance route with sparse points', () => {
    // ~80 km with 15 points = ~0.19 pts/km — clearly synthetic
    const coords: [number, number][] = [];
    for (let i = 0; i < 15; i++) {
      const t = i / 14;
      coords.push([-74.0 + t * 0.7, 40.7 + t * 0.3]);
    }
    expect(isStraightLineGeometry(coords)).toBe(true);
  });
});

describe('fetchTransitLines Amtrak BTS supplement', () => {
  const mockFetchAmtrakRoutes = jest.mocked(fetchAmtrakRoutes);
  const mockFindEndpointForCoords = jest.mocked(findEndpointForCoords);

  beforeEach(() => {
    jest.clearAllMocks();
    __clearTransitLineCache();
  });

  it('fetches OTP and BTS Amtrak in parallel, merging results', async () => {
    // Simulate MTA OTP endpoint covering NYC
    mockFindEndpointForCoords.mockReturnValue({
      label: 'mta-nyc',
      bbox: [40.4, -74.3, 41.4, -72.0] as [number, number, number, number],
      apiStyle: 'rest-v1',
      url: 'https://otp.example.com/otp/routers/default/plan',
    });

    // Mock OTP route list — one subway route
    const mockFetch = jest
      .fn()
      // GET /index/routes
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: '1', shortName: 'A', mode: 'SUBWAY', color: '2850AD', agencyName: 'MTA' },
        ],
      })
      // GET /index/routes/1/patterns
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'p1' }],
      })
      // GET /index/patterns/p1/geometry
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }),
      })
      // GET /index/patterns/p1 (detail)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stops: [] }),
      });

    (global as any).fetch = mockFetch;

    // Mock BTS Amtrak response — returns a route with real geometry
    mockFetchAmtrakRoutes.mockResolvedValueOnce([
      {
        id: 'bts:amtrak:acela',
        name: 'Acela',
        operator: 'Amtrak',
        color: '1A4B8D',
        mode: 'RAIL',
        geometry: [
          [
            [-73.99, 40.75],
            [-73.98, 40.76],
            [-73.97, 40.77],
            [-73.96, 40.78],
          ],
        ],
        stops: [],
      },
    ]);

    const result = await fetchTransitLines(40.7, -74.1, 40.85, -73.9);

    // Both OTP subway and BTS Amtrak included in results
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((l) => l.ref === 'A')).toBe(true);
    expect(result.some((l) => l.name === 'Acela')).toBe(true);

    // BTS Amtrak fetcher was called in parallel
    expect(mockFetchAmtrakRoutes).toHaveBeenCalledTimes(1);
    expect(mockFetchAmtrakRoutes).toHaveBeenCalledWith(40.7, -74.1, 40.85, -73.9);
  });

  it('runs Overpass fallback for local transit when only Amtrak (not OTP) covers the area', async () => {
    // Simulate Chicago — no OTP endpoint
    mockFindEndpointForCoords.mockReturnValue(null);

    // Amtrak has routes through Chicago
    mockFetchAmtrakRoutes.mockResolvedValueOnce([
      {
        id: 'bts:amtrak:california-zephyr',
        name: 'California Zephyr',
        operator: 'Amtrak',
        color: '1A4B8D',
        mode: 'RAIL',
        geometry: [
          [
            [-87.64, 41.85],
            [-87.63, 41.86],
            [-87.62, 41.87],
          ],
        ],
        stops: [],
      },
    ]);

    // Overpass returns CTA Brown Line for one tile, empty for the rest.
    // mockResolvedValue (not Once) covers retries and extra tiles without timeout loops.
    const mockOverpass = jest.mocked(overpassFetch);
    mockOverpass.mockResolvedValueOnce({
      elements: [
        {
          type: 'relation',
          id: 120717,
          tags: {
            route: 'subway',
            ref: 'Brown',
            colour: '#62361b',
            name: 'CTA Brown Line',
            network: 'CTA',
            operator: 'Chicago Transit Authority',
          },
          members: [
            {
              type: 'way',
              ref: 1001,
              role: '',
              geometry: [
                { lat: 41.85, lon: -87.64 },
                { lat: 41.86, lon: -87.63 },
                { lat: 41.87, lon: -87.62 },
              ],
            },
          ],
        },
        {
          type: 'node',
          id: 2001,
          lat: 41.85,
          lon: -87.64,
          tags: { name: 'Kimball', railway: 'station' },
        },
        {
          type: 'node',
          id: 2002,
          lat: 41.87,
          lon: -87.62,
          tags: { name: 'Western', railway: 'station' },
        },
      ],
    });
    mockOverpass.mockResolvedValue({ elements: [] });

    const result = await fetchTransitLines(41.85, -87.7, 41.95, -87.55);

    // Both Amtrak and CTA Brown Line should be present
    expect(result.some((l) => l.name === 'California Zephyr')).toBe(true);
    expect(result.some((l) => l.ref === 'Brown')).toBe(true);

    // Overpass WAS called (this is the regression check — before the fix,
    // overpassFetch was never called because hasAmtrak caused an early return)
    expect(mockOverpass).toHaveBeenCalled();

    // Amtrak fetcher was also called in parallel
    expect(mockFetchAmtrakRoutes).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('runs Overpass fallback when an endpoint exists but returns empty (e.g. DC without WMATA key)', async () => {
    // Simulate DC — WMATA GTFS endpoint matches, but API key is not configured
    mockFindEndpointForCoords.mockReturnValue({
      label: 'WMATA Washington DC Metro',
      bbox: [38.75, -77.5, 39.2, -76.8] as [number, number, number, number],
      apiStyle: 'wmata-gtfs-v1',
      url: 'https://api.wmata.com/gtfs/rail-gtfs.zip',
    });

    // Amtrak has routes through DC
    mockFetchAmtrakRoutes.mockResolvedValueOnce([
      {
        id: 'bts:amtrak:acela',
        name: 'Acela',
        operator: 'Amtrak',
        color: '1A4B8D',
        mode: 'RAIL',
        geometry: [
          [
            [-77.0, 38.9],
            [-76.9, 39.0],
          ],
        ],
        stops: [],
      },
    ]);

    // Overpass returns DC Metro Red Line
    const mockOverpass = jest.mocked(overpassFetch);
    mockOverpass.mockResolvedValueOnce({
      elements: [
        {
          type: 'relation',
          id: 999001,
          tags: {
            route: 'subway',
            ref: 'Red',
            colour: '#BF0D3E',
            name: 'Red Line',
            network: 'WMATA',
            operator: 'Washington Metropolitan Area Transit Authority',
          },
          members: [
            {
              type: 'way',
              ref: 9001,
              role: '',
              geometry: [
                { lat: 38.9, lon: -77.0 },
                { lat: 38.91, lon: -77.01 },
              ],
            },
          ],
        },
        {
          type: 'node',
          id: 9001,
          lat: 38.9,
          lon: -77.0,
          tags: { name: 'Metro Center', railway: 'station' },
        },
      ],
    });
    mockOverpass.mockResolvedValue({ elements: [] });

    const result = await fetchTransitLines(38.85, -77.1, 38.95, -76.95);

    // Both Amtrak and DC Metro Red Line should be present
    expect(result.some((l) => l.name === 'Acela')).toBe(true);
    expect(result.some((l) => l.ref === 'Red')).toBe(true);

    // Overpass WAS called (regression check — before the fix, the
    // findEndpointForCoords skip block blocked Overpass for ANY match)
    expect(mockOverpass).toHaveBeenCalled();

    // Amtrak fetcher was also called in parallel
    expect(mockFetchAmtrakRoutes).toHaveBeenCalledTimes(1);
  }, 15_000);
});
