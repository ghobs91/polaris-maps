import {
  planMotisTrip,
  motisLegMode,
  motisRouteTypeToTransit,
} from '../../src/services/transit/transitousClient';

const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
});

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
    text: async () => '',
  } as Response;
}

describe('planMotisTrip', () => {
  it('builds the MOTIS v5 /plan URL with query parameters', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ itineraries: [] }));

    await planMotisTrip({
      fromPlace: '52.52,13.40',
      toPlace: '52.53,13.41',
      time: '2026-01-01T10:00:00.000Z',
      numItineraries: 3,
      maxTransfers: 2,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v5/plan');
    expect(url).toContain('fromPlace=52.52%2C13.40');
    expect(url).toContain('toPlace=52.53%2C13.41');
    expect(url).toContain('numItineraries=3');
    expect(url).toContain('maxTransfers=2');
    expect(init.headers['User-Agent']).toMatch(/PolarisMaps/);
  });

  it('returns null on a non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(planMotisTrip({ fromPlace: '1,1', toPlace: '2,2' })).resolves.toBeNull();

    warn.mockRestore();
  });
});

describe('mode mapping', () => {
  it('maps MOTIS leg modes to the app LegMode strings', () => {
    expect(motisLegMode('walk')).toBe('WALK');
    expect(motisLegMode('bike')).toBe('BICYCLE');
    expect(motisLegMode('car')).toBe('CAR');
    expect(motisLegMode('transit')).toBe('TRANSIT');
  });

  it('maps MOTIS route types to TransitMode', () => {
    expect(motisRouteTypeToTransit('subway')).toBe('SUBWAY');
    expect(motisRouteTypeToTransit('tram')).toBe('TRAM');
    expect(motisRouteTypeToTransit('ferry')).toBe('FERRY');
    expect(motisRouteTypeToTransit('bus')).toBe('RAIL');
    expect(motisRouteTypeToTransit(undefined)).toBe('RAIL');
  });
});
