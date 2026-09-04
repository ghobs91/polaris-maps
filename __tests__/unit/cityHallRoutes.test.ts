/**
 * Regression test for the City Hall (NYC) over-aggregation bug.
 *
 * Google Maps shows City Hall station served by N/R/W only. Polaris was
 * showing W/1/5/4/J/Z/3/2/A/C/E — the union of every line with tracks
 * passing nearby (Brooklyn Bridge-City Hall 4/5/6/J/Z ~242 m away,
 * Chambers St 1/2/3/A/C/E ~311 m away).
 *
 * Root cause: routes were attributed by *track proximity* (`way(around)`
 * + `rel(bw)`), which is fundamentally broken in dense metros — verified
 * live: even at 150 m the proximity query returns 2/3 (Park Place tracks
 * pass within 150 m of City Hall without serving it), while the
 * membership query returns exactly N/R/W.
 *
 * Guards:
 *  1. fetchRoutesAtStop attributes by relation *membership* (`rel(bn)` on
 *     nearby stop nodes), never by track proximity (`rel(bw)` on ways).
 *  2. Lines with schedule-derived stops (OTP/GTFS) are authoritative, so
 *     geometry heuristics must skip them (hasAuthoritativeStops).
 */

import { overpassFetch } from '../../src/services/overpassClient';

// Mock every native/network dependency of transitLineFetcher so this suite
// runs under Jest (the transitLineFetcher suite itself currently fails to
// load because wmataFetcher pulls in expo virtual modules — pre-existing).
jest.mock('../../src/services/overpassClient', () => ({
  overpassFetch: jest.fn(),
}));
jest.mock('../../src/services/transit/otpEndpointRegistry', () => ({
  findEndpointForCoords: jest.fn().mockReturnValue(null),
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
jest.mock('../../src/services/transit/wmataFetcher', () => ({
  fetchWmataLines: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/transit/gtfsStaticFetcher', () => ({
  fetchGtfsStaticLines: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/transit/dotGtfsFetcher', () => ({
  fetchDotGtfsLines: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    delete: jest.fn(),
    getAllKeys: jest.fn().mockReturnValue([]),
  },
}));

import {
  fetchRoutesAtStop,
  hasAuthoritativeStops,
} from '../../src/services/transit/transitLineFetcher';

const mockOverpass = jest.mocked(overpassFetch);

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Approximate real-world coordinates (MTA / OSM):
const CITY_HALL_BMT = { lat: 40.713288, lon: -74.006978 }; // N/R/W
const BROOKLYN_BRIDGE_IRT = { lat: 40.713065, lon: -74.004117 }; // 4/5/6/J/Z
const CHAMBERS_123 = { lat: 40.715478, lon: -74.009266 }; // 1/2/3

describe('City Hall route over-aggregation (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOverpass.mockResolvedValue({ elements: [] });
  });

  it('neighbouring stations are distinct stops (not one complex)', () => {
    // Sanity: the stations really are ~240 m+ apart. If this fails, the test
    // coordinates are wrong — not the app code.
    const toBB = haversineMeters(
      CITY_HALL_BMT.lat,
      CITY_HALL_BMT.lon,
      BROOKLYN_BRIDGE_IRT.lat,
      BROOKLYN_BRIDGE_IRT.lon,
    );
    const toChambers = haversineMeters(
      CITY_HALL_BMT.lat,
      CITY_HALL_BMT.lon,
      CHAMBERS_123.lat,
      CHAMBERS_123.lon,
    );
    expect(toBB).toBeGreaterThan(200);
    expect(toChambers).toBeGreaterThan(200);
  });

  it('fetchRoutesAtStop attributes by stop membership, not track proximity', async () => {
    // Use a fresh coordinate so the per-stop cache cannot interfere.
    await fetchRoutesAtStop(40.7133, -74.007);
    expect(mockOverpass).toHaveBeenCalledTimes(1);
    const query = (mockOverpass.mock.calls[0][0] as { query: string }).query;
    // Membership: relations containing the stop nodes…
    expect(query).toContain('rel(bn.stops)');
    // …never track-proximity: ways around the point + relations using them.
    expect(query).not.toContain('rel(bw)');
    expect(query).not.toContain('way(around:');
  });

  it('hasAuthoritativeStops trusts schedule data, not OSM heuristics', () => {
    expect(hasAuthoritativeStops({ id: 'otp:MTASBWY:R' })).toBe(true);
    expect(hasAuthoritativeStops({ id: 'osm:relation:9699150' })).toBe(false);
    expect(hasAuthoritativeStops({ id: 'bts:amtrak:acela' })).toBe(false);
  });
});
