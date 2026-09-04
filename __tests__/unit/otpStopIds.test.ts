/**
 * Unit tests for directional OTP stop-ID lookup.
 *
 * A station often has several directional stop IDs sharing one name and
 * location (e.g. MTA City Hall = R24S southbound + R24N northbound at
 * identical coordinates). Querying only the first hides a whole direction
 * of departures ("Downtown & Brooklyn" but never "Uptown & Queens").
 */

import {
  findOtpStopIds,
  findOtpStopId,
  fetchOtpTripStoptimes,
  fetchOtpRoutesAtStop,
  __clearOtpResponseCache,
} from '../../src/services/transit/otpEndpointRegistry';

beforeEach(() => {
  __clearOtpResponseCache();
});

describe('findOtpStopIds', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    // Stops index payload for the MTA endpoint (NYC coords hit it in the
    // real registry, so no endpoint mocking is needed).
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { name: 'City Hall', lat: 40.713277, lon: -74.006984, id: 'MTASBWY:R24S' },
        { name: 'City Hall', lat: 40.713277, lon: -74.006984, id: 'MTASBWY:R24N' },
        // Entrances are filtered out of the index at load time
        { name: 'City Hall', lat: 40.713521, lon: -74.006697, id: 'MTASBWY:R24-entrance-2' },
        { name: 'Cortlandt St', lat: 40.710668, lon: -74.011029, id: 'MTASBWY:R25S' },
      ],
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('returns every directional stop ID for one station name', async () => {
    const ids = await findOtpStopIds('City Hall', 40.7133, -74.007);
    expect(ids).toEqual(['MTASBWY:R24S', 'MTASBWY:R24N']);
  });

  it('findOtpStopId still returns the single best match', async () => {
    await expect(findOtpStopId('City Hall', 40.7133, -74.007)).resolves.toBe('MTASBWY:R24S');
  });

  it('returns empty when nothing matches', async () => {
    await expect(findOtpStopIds('Nowhere Station', 40.7133, -74.007)).resolves.toEqual([]);
  });
});

describe('fetchOtpTripStoptimes', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('fetches and orders the trip stop list', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          stopId: 'MTASBWY:R25S',
          stopName: 'Cortlandt St',
          stopIndex: 1,
          scheduledArrival: 100,
          scheduledDeparture: 100,
          realtimeArrival: 100,
          realtimeDeparture: 100,
          realtime: false,
        },
        {
          stopId: 'MTASBWY:R24S',
          stopName: 'City Hall',
          stopIndex: 0,
          scheduledArrival: 0,
          scheduledDeparture: 0,
          realtimeArrival: 5,
          realtimeDeparture: 5,
          realtime: true,
        },
      ],
    });
    (global as any).fetch = fetchMock;

    const stops = await fetchOtpTripStoptimes('MTASBWY:96287', 40.7133, -74.007);

    expect(stops.map((s) => s.stopName)).toEqual(['City Hall', 'Cortlandt St']);
    expect(stops[0].realtime).toBe(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/index/trips/MTASBWY%3A96287/stoptimes');
  });

  it('returns empty when the endpoint is unavailable', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });
    await expect(fetchOtpTripStoptimes('MTASBWY:96287', 40.7133, -74.007)).resolves.toEqual([]);
  });
});

describe('response caches', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reuses fresh route responses instead of refetching', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ shortName: 'W', longName: 'Broadway Local', mode: 'SUBWAY' }],
    });
    (global as any).fetch = fetchMock;

    // Concurrent duplicate calls share one request (badges + departures taps)
    const [a, b] = await Promise.all([
      fetchOtpRoutesAtStop('MTASBWY:R24S', 40.7133, -74.007),
      fetchOtpRoutesAtStop('MTASBWY:R24S', 40.7133, -74.007),
    ]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Sequential call within TTL reuses the cache too (e.g. trip prefetch)
    await fetchOtpTripStoptimes('MTASBWY:96287', 40.7133, -74.007);
    await fetchOtpTripStoptimes('MTASBWY:96287', 40.7133, -74.007);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache empty results', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false });
    (global as any).fetch = fetchMock;

    await fetchOtpRoutesAtStop('MTASBWY:R24S', 40.7133, -74.007);
    await fetchOtpRoutesAtStop('MTASBWY:R24S', 40.7133, -74.007);
    // A transient failure must not blank data — each call retries
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
