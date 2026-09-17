import { fetchTransitousDepartures } from '../../src/services/transit/transitousDepartures';

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
}

const stopEvent = {
  stop: { name: 'Alexanderplatz', id: 'de:11000:900100003', lat: 52.521, lon: 13.413 },
  events: [
    {
      stopId: 'de:11000:900100003',
      stopName: 'Alexanderplatz',
      stopLat: 52.521,
      stopLon: 13.413,
      departure: {
        scheduledTime: new Date(Date.now() + 5 * 60_000).toISOString(),
        estimatedTime: new Date(Date.now() + 7 * 60_000).toISOString(),
        delaySeconds: 120,
      },
      trip: {
        tripId: 'trip-1',
        line: { shortName: 'U2', name: 'U-Bahn U2', color: 'E2001A', type: 'subway' },
        headsign: 'Pankow',
      },
    },
  ],
};

describe('fetchTransitousDepartures', () => {
  it('builds the stoptimes URL with the stop coordinates', async () => {
    mockFetch.mockResolvedValue(jsonResponse(stopEvent));

    await fetchTransitousDepartures('Alexanderplatz', 52.521, 13.413);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/stoptimes');
    expect(url).toContain('lat=52.521');
    expect(url).toContain('lon=13.413');
  });

  it('maps stop events to StopDepartureInfo with realtime delay', async () => {
    mockFetch.mockResolvedValue(jsonResponse(stopEvent));

    const info = await fetchTransitousDepartures('Alexanderplatz', 52.521, 13.413);

    expect(info).not.toBeNull();
    expect(info!.stopName).toBe('Alexanderplatz');
    expect(info!.routes[0]).toMatchObject({ name: 'U2', mode: 'SUBWAY' });
    expect(info!.departures[0]).toMatchObject({
      routeName: 'U2',
      headsign: 'Pankow',
      isRealtime: true,
      mode: 'SUBWAY',
    });
    // Real-time (7 min) wins over scheduled (5 min).
    expect(info!.departures[0].minutesAway).toBe(7);
  });

  it('returns null when the request fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(fetchTransitousDepartures('X', 1, 1)).resolves.toBeNull();
    warn.mockRestore();
  });
});
