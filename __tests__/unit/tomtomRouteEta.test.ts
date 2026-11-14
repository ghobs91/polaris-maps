jest.mock('../../src/constants/config', () => ({ tomtomApiKey: 'test-key' }));

jest.mock('../../src/services/traffic/tomtomAccess', () => ({
  isTomTomConfigured: () => true,
  canCallTomTom: () => true,
  noteTomTomRequest: jest.fn(),
  noteTomTomResponse: jest.fn(),
  noteTomTomNetworkError: jest.fn(),
}));

import {
  __resetTomTomRouteEtaCacheForTests,
  fetchTomTomRouteEta,
} from '../../src/services/traffic/tomtomRouteEta';

const ORIGIN = { lat: 37.77, lng: -122.42 };
const DESTINATION = { lat: 37.8, lng: -122.4 };

describe('fetchTomTomRouteEta', () => {
  beforeEach(() => {
    __resetTomTomRouteEtaCacheForTests();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [{ summary: { travelTimeInSeconds: 600, trafficDelayInSeconds: 60 } }],
      }),
    }) as unknown as typeof fetch;
  });

  it('caches the same origin/destination pair for five minutes', async () => {
    const first = await fetchTomTomRouteEta(ORIGIN, DESTINATION);
    const second = await fetchTomTomRouteEta(ORIGIN, DESTINATION);

    expect(first).toEqual({ travelTimeSeconds: 600, trafficDelaySeconds: 60 });
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('caches nearby endpoints at ~100 m precision', async () => {
    await fetchTomTomRouteEta(ORIGIN, DESTINATION);
    await fetchTomTomRouteEta({ lat: 37.7701, lng: -122.4201 }, DESTINATION);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
