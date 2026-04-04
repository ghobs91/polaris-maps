// Mock the config module so OTP_BASE_URL is always set
jest.mock('../../src/constants/config', () => ({
  ...jest.requireActual('../../src/constants/config'),
  OTP_BASE_URL: 'http://localhost:8080',
  OTP_GRAPHQL_PATH: '/otp/gtfs/v1',
}));

import {
  planTransitTrip,
  getStopsInBounds,
  getStopDepartures,
  getNearbyStops,
  isOtpConfigured,
  isUserOtpConfigured,
} from '../../src/services/transit/transitRoutingService';
import {
  findEndpointForCoords,
  OTP_ENDPOINTS,
} from '../../src/services/transit/otpEndpointRegistry';

// ── Mock fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

// ── Fixtures ────────────────────────────────────────────────────────

function makeItineraryResponse() {
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              start: '2026-04-01T08:00:00-04:00',
              end: '2026-04-01T08:45:00-04:00',
              legs: [
                {
                  mode: 'WALK',
                  from: { name: 'Origin', lat: 40.748, lon: -73.985, departure: null, stop: null },
                  to: {
                    name: 'Penn Station',
                    lat: 40.75,
                    lon: -73.99,
                    arrival: null,
                    stop: {
                      gtfsId: 'MTA:101',
                      name: 'Penn Station',
                      code: null,
                      platformCode: null,
                    },
                  },
                  startTime: 1711958400000,
                  endTime: 1711958700000,
                  duration: 300,
                  distance: 400,
                  route: null,
                  trip: null,
                  headsign: null,
                  intermediateStops: null,
                  legGeometry: { points: '_p~iF~ps|U' },
                  realTime: false,
                  alerts: null,
                },
                {
                  mode: 'SUBWAY',
                  from: {
                    name: 'Penn Station',
                    lat: 40.75,
                    lon: -73.99,
                    departure: { scheduledTime: '2026-04-01T08:05:00-04:00', estimated: null },
                    stop: {
                      gtfsId: 'MTA:101',
                      name: 'Penn Station',
                      code: '1',
                      platformCode: null,
                    },
                  },
                  to: {
                    name: 'Times Square',
                    lat: 40.758,
                    lon: -73.985,
                    arrival: {
                      scheduledTime: '2026-04-01T08:15:00-04:00',
                      estimated: { time: '2026-04-01T08:16:00-04:00', delay: 60 },
                    },
                    stop: {
                      gtfsId: 'MTA:102',
                      name: 'Times Square',
                      code: null,
                      platformCode: null,
                    },
                  },
                  startTime: 1711958700000,
                  endTime: 1711959300000,
                  duration: 600,
                  distance: 1200,
                  route: {
                    gtfsId: 'MTA:1',
                    shortName: '1',
                    longName: 'Broadway-7th Ave Local',
                    color: 'EE352E',
                    textColor: 'FFFFFF',
                    mode: 'SUBWAY',
                    agency: { gtfsId: 'MTA:MTA', name: 'MTA New York City Transit' },
                  },
                  trip: { gtfsId: 'MTA:trip-123' },
                  headsign: 'South Ferry',
                  intermediateStops: [
                    {
                      name: '34th St',
                      lat: 40.7527,
                      lon: -73.9877,
                      arrival: { scheduledTime: '2026-04-01T08:10:00-04:00', estimated: null },
                      departure: { scheduledTime: '2026-04-01T08:10:30-04:00', estimated: null },
                    },
                  ],
                  legGeometry: { points: '_p~iF~ps|U_ulLnnqC' },
                  realTime: true,
                  alerts: [],
                },
                {
                  mode: 'WALK',
                  from: {
                    name: 'Times Square',
                    lat: 40.758,
                    lon: -73.985,
                    departure: null,
                    stop: null,
                  },
                  to: { name: 'Destination', lat: 40.76, lon: -73.98, arrival: null, stop: null },
                  startTime: 1711959300000,
                  endTime: 1711959600000,
                  duration: 300,
                  distance: 350,
                  route: null,
                  trip: null,
                  headsign: null,
                  intermediateStops: null,
                  legGeometry: { points: '_p~iF~ps|U' },
                  realTime: false,
                  alerts: null,
                },
              ],
            },
          },
        ],
      },
    },
  };
}

function makeStopsResponse() {
  return {
    data: {
      stopsByBbox: [
        {
          gtfsId: 'MTA:101',
          name: 'Penn Station',
          code: '1',
          lat: 40.75,
          lon: -73.99,
          routes: [
            {
              gtfsId: 'MTA:1',
              shortName: '1',
              longName: 'Broadway Local',
              color: 'EE352E',
              textColor: 'FFFFFF',
              mode: 'SUBWAY',
              agency: { gtfsId: 'MTA:MTA', name: 'MTA' },
            },
          ],
          vehicleMode: 'SUBWAY',
        },
        {
          gtfsId: 'MTA:201',
          name: '34th St & 7th Ave',
          code: null,
          lat: 40.752,
          lon: -73.989,
          routes: [
            {
              gtfsId: 'MTA:M34',
              shortName: 'M34',
              longName: '34th St Crosstown',
              color: null,
              textColor: null,
              mode: 'BUS',
              agency: { gtfsId: 'MTA:MTA', name: 'MTA' },
            },
          ],
          vehicleMode: 'BUS',
        },
      ],
    },
  };
}

function makeDeparturesResponse() {
  return {
    data: {
      stop: {
        gtfsId: 'MTA:101',
        name: 'Penn Station',
        lat: 40.75,
        lon: -73.99,
        stoptimesWithoutPatterns: [
          {
            scheduledDeparture: 29100,
            realtimeDeparture: 29160,
            departureDelay: 60,
            realtime: true,
            headsign: 'South Ferry',
            trip: {
              gtfsId: 'MTA:trip-123',
              route: {
                shortName: '1',
                longName: 'Broadway Local',
                color: 'EE352E',
                mode: 'SUBWAY',
              },
            },
          },
          {
            scheduledDeparture: 29400,
            realtimeDeparture: 29400,
            departureDelay: 0,
            realtime: false,
            headsign: 'Van Cortlandt Park',
            trip: {
              gtfsId: 'MTA:trip-456',
              route: {
                shortName: '1',
                longName: 'Broadway Local',
                color: 'EE352E',
                mode: 'SUBWAY',
              },
            },
          },
        ],
      },
    },
  };
}

function makeNearbyStopsResponse() {
  return {
    data: {
      nearest: {
        edges: [
          {
            node: {
              distance: 120,
              place: {
                gtfsId: 'MTA:101',
                name: 'Penn Station',
                code: '1',
                lat: 40.75,
                lon: -73.99,
                routes: [],
                vehicleMode: 'SUBWAY',
              },
            },
          },
        ],
      },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('isOtpConfigured', () => {
  it('returns true when OTP base URL is set', () => {
    expect(isOtpConfigured()).toBe(true);
  });

  it('returns true for coordinates inside a registry bbox', () => {
    // Mineola, NY — inside MTA bbox
    expect(isOtpConfigured(40.7475, -73.6407)).toBe(true);
  });

  it('returns true even for coords outside registry when OTP_BASE_URL is set', () => {
    // Random location in Antarctica
    expect(isOtpConfigured(-80, 0)).toBe(true);
  });
});

describe('isUserOtpConfigured', () => {
  it('returns true when OTP_BASE_URL is set', () => {
    expect(isUserOtpConfigured()).toBe(true);
  });
});

describe('findEndpointForCoords (registry)', () => {
  it('returns MTA endpoint for NYC coordinates', () => {
    const ep = findEndpointForCoords(40.7475, -73.6407);
    expect(ep).not.toBeNull();
    expect(ep!.label).toContain('MTA');
    expect(ep!.apiStyle).toBe('rest-v1');
  });

  it('returns TriMet endpoint for Portland coordinates', () => {
    const ep = findEndpointForCoords(45.52, -122.68);
    expect(ep).not.toBeNull();
    expect(ep!.label).toContain('TriMet');
    expect(ep!.apiStyle).toBe('rest-v1');
  });

  it('returns Entur endpoint for Oslo coordinates', () => {
    const ep = findEndpointForCoords(59.91, 10.75);
    expect(ep).not.toBeNull();
    expect(ep!.label).toContain('Entur');
    expect(ep!.apiStyle).toBe('transmodel-v3');
  });

  it('returns null for coordinates outside all bboxes', () => {
    const ep = findEndpointForCoords(-33.87, 151.21); // Sydney
    expect(ep).toBeNull();
  });

  it('has at least one endpoint in the registry', () => {
    expect(OTP_ENDPOINTS.length).toBeGreaterThan(0);
  });
});

describe('planTransitTrip', () => {
  it('uses OTP1 REST when registry matches (MTA NYC)', async () => {
    // Coordinates inside MTA bbox → OTP1 REST endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        plan: {
          itineraries: [
            {
              duration: 2040,
              startTime: 1775296260000,
              startTimeFmt: '2026-04-04T05:51:00-04:00',
              endTime: 1775298300000,
              endTimeFmt: '2026-04-04T06:25:00-04:00',
              walkTime: 300,
              transitTime: 1740,
              waitingTime: 0,
              walkDistance: 350,
              transfers: 0,
              legs: [
                {
                  startTime: 1775296260000,
                  endTime: 1775296560000,
                  mode: 'WALK',
                  from: { name: 'Origin', lat: 40.7475, lon: -73.6407 },
                  to: { name: 'Mineola', lat: 40.7471, lon: -73.6396, stopId: 'LIRR:Mineola' },
                  duration: 300,
                  distance: 350,
                  legGeometry: { points: '_p~iF~ps|U', length: 2 },
                },
                {
                  startTime: 1775296560000,
                  endTime: 1775298300000,
                  mode: 'RAIL',
                  routeShortName: 'Port Jefferson',
                  routeLongName: 'Port Jefferson Branch',
                  routeColor: '0039A6',
                  agencyName: 'MTA Long Island Rail Road',
                  headsign: 'Penn Station',
                  from: { name: 'Mineola', lat: 40.7471, lon: -73.6396, stopId: 'LIRR:Mineola' },
                  to: {
                    name: 'Penn Station',
                    lat: 40.7505,
                    lon: -73.9934,
                    stopId: 'LIRR:PennStation',
                  },
                  duration: 1740,
                  distance: 35000,
                  legGeometry: { points: '_p~iF~ps|U_ulLnnqC', length: 10 },
                  realTime: false,
                  intermediateStops: [
                    {
                      name: 'New Hyde Park',
                      lat: 40.7309,
                      lon: -73.6879,
                      arrival: 0,
                      departure: 0,
                    },
                    { name: 'Jamaica', lat: 40.7001, lon: -73.8073, arrival: 0, departure: 0 },
                  ],
                },
              ],
            },
          ],
        },
      }),
    });

    const result = await planTransitTrip({
      from: { lat: 40.7475, lng: -73.6407 },
      to: { lat: 40.7505, lng: -73.9934 },
    });

    expect(result).toHaveLength(1);
    const it = result[0];
    expect(it.legs).toHaveLength(2);
    expect(it.legs[0].mode).toBe('WALK');
    expect(it.legs[1].mode).toBe('RAIL');
    expect(it.legs[1].route?.shortName).toBe('Port Jefferson');
    expect(it.legs[1].headsign).toBe('Penn Station');
    expect(it.duration).toBe(2040);

    // Verify it hit the MTA endpoint, not our user-configured one
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('otp-mta-prod.camsys-apps.com');
  });

  it('falls back to user-configured OTP when registry endpoint fails', async () => {
    // First call: registry endpoint fails
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    // Second call: user-configured OTP succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeItineraryResponse(),
    });

    const result = await planTransitTrip({
      from: { lat: 40.748, lng: -73.985 },
      to: { lat: 40.76, lng: -73.98 },
    });

    expect(result).toHaveLength(1);
    expect(result[0].legs).toHaveLength(3);
    // Second call should hit user-configured OTP
    const secondUrl = mockFetch.mock.calls[1][0];
    expect(secondUrl).toContain('localhost:8080');
  });

  it('uses user-configured OTP for regions not in registry', async () => {
    // Sydney coordinates — no registry match
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { planConnection: { edges: [] } } }),
    });

    await planTransitTrip({
      from: { lat: -33.87, lng: 151.21 },
      to: { lat: -33.88, lng: 151.2 },
    });

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('localhost:8080');
  });

  it('includes transit modes in the GraphQL request (user-configured)', async () => {
    // Use coordinates outside any registry bbox
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { planConnection: { edges: [] } } }),
    });

    await planTransitTrip({
      from: { lat: -33.87, lng: 151.21 },
      to: { lat: -33.88, lng: 151.2 },
      modes: ['BUS', 'SUBWAY'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.transitModes).toEqual([{ mode: 'BUS' }, { mode: 'SUBWAY' }]);
  });

  it('throws on GraphQL errors from user-configured OTP', async () => {
    // Use coordinates outside any registry bbox
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'No transit data available' }] }),
    });

    await expect(
      planTransitTrip({
        from: { lat: -33.87, lng: 151.21 },
        to: { lat: -33.88, lng: 151.2 },
      }),
    ).rejects.toThrow('OTP GraphQL error: No transit data available');
  });

  it('throws on HTTP error from user-configured OTP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Server overloaded',
    });

    await expect(
      planTransitTrip({
        from: { lat: -33.87, lng: 151.21 },
        to: { lat: -33.88, lng: 151.2 },
      }),
    ).rejects.toThrow('OTP API error 503');
  });
});

describe('getStopsInBounds', () => {
  it('fetches transit stops within a bounding box', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeStopsResponse(),
    });

    const stops = await getStopsInBounds(40.7, -74.0, 40.8, -73.9);

    expect(stops).toHaveLength(2);
    expect(stops[0].gtfsId).toBe('MTA:101');
    expect(stops[0].name).toBe('Penn Station');
    expect(stops[0].vehicleMode).toBe('SUBWAY');
    expect(stops[1].vehicleMode).toBe('BUS');
  });
});

describe('getStopDepartures', () => {
  it('fetches departures for a specific stop', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeDeparturesResponse(),
    });

    const result = await getStopDepartures('MTA:101', 10);

    expect(result.stop.name).toBe('Penn Station');
    expect(result.departures).toHaveLength(2);
    expect(result.departures[0].headsign).toBe('South Ferry');
    expect(result.departures[0].realtime).toBe(true);
    expect(result.departures[0].departureDelay).toBe(60);
    expect(result.departures[1].realtime).toBe(false);
  });
});

describe('getNearbyStops', () => {
  it('fetches transit stops near a point', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeNearbyStopsResponse(),
    });

    const result = await getNearbyStops(40.748, -73.985, 500, 10);

    expect(result).toHaveLength(1);
    expect(result[0].distanceMeters).toBe(120);
    expect(result[0].stop.name).toBe('Penn Station');
    expect(result[0].departures).toEqual([]); // Not populated by this call
  });
});
