import {
  searchAppleMaps,
  findAppleMatch,
  fetchAppleMapsPois,
  clearAccessTokenCache,
} from '../../src/services/poi/mapkitFetcher';

// Mock config to provide a fake token
jest.mock('../../src/constants/config', () => ({
  appleMapkitToken: 'test-jwt',
}));

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/** Helper: set up fetch to respond with a token exchange then a search result */
function mockTokenThenSearch(searchBody: object) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: 'access-token-xyz', expiresInSeconds: 1800 }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => searchBody,
    } as Response);
}

afterEach(() => {
  mockFetch.mockReset();
  clearAccessTokenCache();
});

describe('searchAppleMaps', () => {
  it('exchanges JWT for access token then searches', async () => {
    mockTokenThenSearch({
      results: [
        {
          id: 'apple-1',
          name: 'Test Cafe',
          coordinate: { latitude: 40.7128, longitude: -74.006 },
          formattedAddressLines: ['123 Main St', 'New York, NY 10001', 'United States'],
          poiCategory: 'Cafe',
        },
      ],
    });

    const results = await searchAppleMaps('Test Cafe', 40.7128, -74.006);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Cafe');
    expect(results[0].poiCategory).toBe('Cafe');
    expect(results[0].formattedAddressLines).toEqual([
      '123 Main St',
      'New York, NY 10001',
      'United States',
    ]);

    // First call is token exchange
    const [tokenUrl, tokenOpts] = mockFetch.mock.calls[0];
    expect(String(tokenUrl)).toContain('/v1/token');
    expect((tokenOpts?.headers as Record<string, string>)?.Authorization).toBe('Bearer test-jwt');

    // Second call is the search
    const [searchUrl, searchOpts] = mockFetch.mock.calls[1];
    expect(String(searchUrl)).toContain('/v1/search');
    expect(String(searchUrl)).toContain('q=Test+Cafe');
    expect((searchOpts?.headers as Record<string, string>)?.Authorization).toBe(
      'Bearer access-token-xyz',
    );
  });

  it('returns empty array when token exchange fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    const results = await searchAppleMaps('Cafe', 40.0, -74.0);
    expect(results).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the token call, no search
  });

  it('returns empty array when search returns error', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'tok', expiresInSeconds: 1800 }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const results = await searchAppleMaps('Cafe', 40.0, -74.0);
    expect(results).toEqual([]);
  });

  it('returns empty array when config token is missing', async () => {
    jest.resetModules();
    jest.doMock('../../src/constants/config', () => ({ appleMapkitToken: '' }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { searchAppleMaps: search } = require('../../src/services/poi/mapkitFetcher');
    const results = await search('Cafe', 40.0, -74.0);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('findAppleMatch', () => {
  it('returns closest result within 200m', async () => {
    mockTokenThenSearch({
      results: [
        {
          id: 'far',
          name: 'Far Cafe',
          coordinate: { latitude: 40.72, longitude: -74.006 }, // ~800m away
        },
        {
          id: 'close',
          name: 'Close Cafe',
          coordinate: { latitude: 40.7129, longitude: -74.0061 }, // ~15m away
          poiCategory: 'Cafe',
        },
      ],
    });

    const match = await findAppleMatch('Cafe', 40.7128, -74.006);
    expect(match).not.toBeNull();
    expect(match!.id).toBe('close');
    expect(match!.poiCategory).toBe('Cafe');
  });

  it('returns null when no result is within 200m', async () => {
    mockTokenThenSearch({
      results: [
        {
          id: 'far',
          name: 'Far Cafe',
          coordinate: { latitude: 41.0, longitude: -74.0 }, // >30km away
        },
      ],
    });

    const match = await findAppleMatch('Cafe', 40.7128, -74.006);
    expect(match).toBeNull();
  });

  it('returns null when search returns empty results', async () => {
    mockTokenThenSearch({ results: [] });
    const match = await findAppleMatch('Nonexistent', 0, 0);
    expect(match).toBeNull();
  });
});

describe('fetchAppleMapsPois', () => {
  it('merges query groups, clips to bbox, and converts to OsmPoi', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'access-token-xyz', expiresInSeconds: 1800 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'apple-1',
              name: 'IHOP',
              coordinate: { latitude: 40.7249, longitude: -73.5276 },
              poiCategory: 'Restaurant',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'apple-2',
              name: 'Panera Bread',
              coordinate: { latitude: 40.7251, longitude: -73.5271 },
              poiCategory: 'Cafe',
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'apple-outside',
              name: 'Far Away Shop',
              coordinate: { latitude: 41.0, longitude: -74.0 },
              poiCategory: 'Store',
            },
          ],
        }),
      } as Response);

    const result = await fetchAppleMapsPois(40.7244, -73.5278, 40.7267, -73.5264);

    expect(result.map((poi) => poi.name)).toEqual(['IHOP', 'Panera Bread']);
    expect(result[0]).toMatchObject({ type: 'amenity', subtype: 'restaurant' });
    expect(result[1]).toMatchObject({ type: 'amenity', subtype: 'cafe' });
  });
});
