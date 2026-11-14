jest.mock('../../src/constants/config', () => ({
  tomtomApiKey: 'test-key',
  TOMTOM_FLOW_BASE_URL: 'https://tomtom.test/flow',
}));

jest.mock('../../src/services/traffic/tomtomAccess', () => ({
  isTomTomConfigured: () => true,
  canCallTomTom: () => true,
  noteTomTomRequest: jest.fn(),
  noteTomTomResponse: jest.fn(),
  noteTomTomNetworkError: jest.fn(),
}));

import { fetchTomTomTraffic } from '../../src/services/traffic/tomtomFetcher';

const VIEWPORT = { west: -122.6, south: 37.2, east: -121.5, north: 38.0, zoom: 14 };

const RESPONSE = {
  flowSegmentData: {
    frc: 'FRC2',
    currentSpeed: 45,
    freeFlowSpeed: 60,
    currentTravelTime: 120,
    freeFlowTravelTime: 90,
    confidence: 0.95,
    coordinates: {
      coordinate: [
        { latitude: 37.5, longitude: -122.2 },
        { latitude: 37.51, longitude: -122.21 },
      ],
    },
  },
};

describe('fetchTomTomTraffic cell targeting', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RESPONSE,
    }) as unknown as typeof fetch;
  });

  it('queries one point per unresolved cell instead of the whole grid', async () => {
    await fetchTomTomTraffic(VIEWPORT, ['9q8yy', '9q8yz']);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('makes no request when the cascade has no unresolved cells', async () => {
    await fetchTomTomTraffic(VIEWPORT, []);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the viewport grid when no cell list is supplied', async () => {
    await fetchTomTomTraffic(VIEWPORT);
    expect(global.fetch).toHaveBeenCalledTimes(16); // zoom 14 → 4×4 grid
  });
});
