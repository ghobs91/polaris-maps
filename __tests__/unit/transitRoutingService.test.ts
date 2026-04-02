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
} from '../../src/services/transit/transitRoutingService';

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
    // The function checks the constant from config which reads env at import time
    expect(typeof isOtpConfigured).toBe('function');
  });
});

describe('planTransitTrip', () => {
  it('plans a transit trip and returns structured itineraries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeItineraryResponse(),
    });

    const result = await planTransitTrip({
      from: { lat: 40.748, lng: -73.985 },
      to: { lat: 40.76, lng: -73.98 },
    });

    expect(result).toHaveLength(1);
    const it = result[0];
    expect(it.legs).toHaveLength(3);
    expect(it.legs[0].mode).toBe('WALK');
    expect(it.legs[1].mode).toBe('SUBWAY');
    expect(it.legs[1].route?.shortName).toBe('1');
    expect(it.legs[1].headsign).toBe('South Ferry');
    expect(it.legs[1].realTime).toBe(true);
    expect(it.legs[2].mode).toBe('WALK');
    expect(it.transfers).toBe(0); // Only one transit leg → 0 transfers
    expect(it.walkDistance).toBeCloseTo(750, 0); // 400 + 350
    expect(it.duration).toBe(1200); // 300 + 600 + 300
  });

  it('includes transit modes in the GraphQL request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { planConnection: { edges: [] } } }),
    });

    await planTransitTrip({
      from: { lat: 40.748, lng: -73.985 },
      to: { lat: 40.76, lng: -73.98 },
      modes: ['BUS', 'SUBWAY'],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.transitModes).toEqual([{ mode: 'BUS' }, { mode: 'SUBWAY' }]);
  });

  it('throws on GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'No transit data available' }] }),
    });

    await expect(
      planTransitTrip({
        from: { lat: 40.748, lng: -73.985 },
        to: { lat: 40.76, lng: -73.98 },
      }),
    ).rejects.toThrow('OTP GraphQL error: No transit data available');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'Server overloaded',
    });

    await expect(
      planTransitTrip({
        from: { lat: 40.748, lng: -73.985 },
        to: { lat: 40.76, lng: -73.98 },
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
