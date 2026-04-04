/**
 * Unit tests for the MBTA V3 API fetcher.
 *
 * Tests the data transformation logic (JSON:API → TransitRouteLine / Departure)
 * with mocked fetch responses. Does NOT hit the live MBTA API.
 */

// Minimal mock for react-native-mmkv (some transitive imports need it)
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getBoolean: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import {
  fetchMbtaLines,
  fetchMbtaDepartures,
  isInMbtaArea,
} from '../../src/services/transit/mbtaFetcher';

// ── Fixtures ────────────────────────────────────────────────────────

function makeRoute(id: string, type: number, color: string, longName: string, shortName = '') {
  return {
    type: 'route',
    id,
    attributes: { type, color, long_name: longName, short_name: shortName },
    relationships: {},
  };
}

function makeShape(id: string, polyline: string) {
  return {
    type: 'shape',
    id,
    attributes: { polyline },
    relationships: {},
  };
}

function makeStop(
  id: string,
  name: string,
  lat: number,
  lon: number,
  locType = 1,
  parentId?: string,
) {
  return {
    type: 'stop',
    id,
    attributes: { name, latitude: lat, longitude: lon, location_type: locType },
    relationships: {
      parent_station: { data: parentId ? { type: 'stop', id: parentId } : null },
    },
  };
}

function makeSchedule(id: string, routeId: string, tripId: string, depTime: string) {
  return {
    type: 'schedule',
    id,
    attributes: { departure_time: depTime },
    relationships: {
      route: { data: { type: 'route', id: routeId } },
      trip: { data: { type: 'trip', id: tripId } },
    },
  };
}

function makeTrip(id: string, headsign: string) {
  return {
    type: 'trip',
    id,
    attributes: { headsign },
  };
}

// A simple encoded polyline for testing (represents a short line near Boston)
// Encodes roughly: (42.35, -71.06) → (42.36, -71.07) in precision-5
const SAMPLE_POLYLINE = 'mxqaGzsuqLyFjN';

// ── Tests ───────────────────────────────────────────────────────────

describe('isInMbtaArea', () => {
  it('returns true for Boston coordinates', () => {
    expect(isInMbtaArea(42.36, -71.06)).toBe(true);
  });

  it('returns true for commuter rail extent (Providence)', () => {
    expect(isInMbtaArea(41.82, -71.41)).toBe(true);
  });

  it('returns false for NYC', () => {
    expect(isInMbtaArea(40.75, -73.99)).toBe(false);
  });

  it('returns false for far-away coordinates', () => {
    expect(isInMbtaArea(34.05, -118.24)).toBe(false);
  });
});

describe('fetchMbtaLines', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('transforms MBTA V3 API response into TransitRouteLine[]', async () => {
    // fetchMbtaLines caches results, so the first call from isInMbtaArea tests
    // hasn't triggered it yet (those don't call fetchMbtaLines).
    // We just need to mock fetch before calling.
    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    // Mock /routes response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          makeRoute('Red', 1, 'DA291C', 'Red Line'),
          makeRoute('CR-Franklin', 2, '80276C', 'Franklin/Foxboro Line'),
        ],
        included: [],
      }),
    });

    // Mock /shapes for Red line
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [makeShape('canonical-red', SAMPLE_POLYLINE)],
        included: [],
      }),
    });

    // Mock /stops for Red line
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          makeStop('place-pktrm', 'Park Street', 42.3564, -71.0624, 1),
          makeStop('place-dwnxg', 'Downtown Crossing', 42.3555, -71.0604, 1),
        ],
        included: [],
      }),
    });

    // Mock /shapes for CR-Franklin
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [makeShape('canonical-franklin', SAMPLE_POLYLINE)],
        included: [],
      }),
    });

    // Mock /stops for CR-Franklin
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          makeStop('place-sstat', 'South Station', 42.3523, -71.0552, 1),
          makeStop('place-FB-0118', 'Dedham Corporate Center', 42.2271, -71.1743, 1),
        ],
        included: [],
      }),
    });

    const lines = await fetchMbtaLines();

    expect(lines).toHaveLength(2);

    // Red Line
    expect(lines[0].id).toBe('mbta:Red');
    expect(lines[0].name).toBe('Red Line');
    expect(lines[0].color).toBe('DA291C');
    expect(lines[0].mode).toBe('SUBWAY');
    expect(lines[0].geometry.length).toBeGreaterThan(0);
    expect(lines[0].stops).toHaveLength(2);
    expect(lines[0].stops[0].name).toBe('Park Street');

    // Franklin Line
    expect(lines[1].id).toBe('mbta:CR-Franklin');
    expect(lines[1].name).toBe('Franklin/Foxboro Line');
    expect(lines[1].color).toBe('80276C');
    expect(lines[1].mode).toBe('RAIL');
    expect(lines[1].stops).toHaveLength(2);
  });
});

describe('fetchMbtaDepartures', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns schedule-based departures with headsigns', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    const futureTime = new Date(Date.now() + 30 * 60_000).toISOString();
    const futureTime2 = new Date(Date.now() + 60 * 60_000).toISOString();

    // Mock /stops (nearby search)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          makeStop('FB-0118-01', 'Dedham Corporate Center', 42.2271, -71.1743, 0, 'place-FB-0118'),
        ],
        included: [],
      }),
    });

    // Mock /schedules
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          makeSchedule('sched-1', 'CR-Franklin', 'trip-1', futureTime),
          makeSchedule('sched-2', 'CR-Franklin', 'trip-2', futureTime2),
        ],
        included: [
          makeRoute('CR-Franklin', 2, '80276C', 'Franklin/Foxboro Line'),
          makeTrip('trip-1', 'South Station'),
          makeTrip('trip-2', 'Forge Park/495'),
        ],
      }),
    });

    // Mock /predictions (empty — no real-time data)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], included: [] }),
    });

    const info = await fetchMbtaDepartures('Dedham Corporate Center', 42.2271, -71.1743);

    expect(info).not.toBeNull();
    expect(info!.stopName).toBe('Dedham Corporate Center');
    expect(info!.departures).toHaveLength(2);
    expect(info!.departures[0].headsign).toBe('South Station');
    expect(info!.departures[0].routeName).toBe('Franklin/Foxboro Line');
    expect(info!.departures[0].color).toBe('80276C');
    expect(info!.departures[0].isRealtime).toBe(false);
    expect(info!.departures[1].headsign).toBe('Forge Park/495');
    expect(info!.routes).toHaveLength(1);
    expect(info!.routes[0].name).toBe('Franklin/Foxboro Line');
  });
});
