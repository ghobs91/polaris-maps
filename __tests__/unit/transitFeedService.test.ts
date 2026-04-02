// Mock the config module so tokens/URLs are always set
jest.mock('../../src/constants/config', () => ({
  ...jest.requireActual('../../src/constants/config'),
  MOBILITY_DB_API_URL: 'https://api.mobilitydatabase.org',
  mobilityDbRefreshToken: 'test-refresh-token',
  TRANSIT_FEED_CACHE_TTL_MS: 86400000,
}));

// ── Mock fetch ──────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Get a fresh copy of the module with no cached tokens or feeds.
 * Each call re-imports, so module-level `accessToken` and `feedCache` are reset.
 */
function getFreshModule() {
  let mod: typeof import('../../src/services/transit/transitFeedService');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../src/services/transit/transitFeedService');
  });
  return mod!;
}

function mockTokenResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }),
  });
}

function makeFeed(id: string, provider: string, lat = 40.7, lng = -74.0) {
  return {
    id,
    data_type: 'gtfs',
    status: 'active',
    provider,
    feed_name: 'Bus',
    locations: [{ country_code: 'US', country: 'United States', municipality: 'New York' }],
    latest_dataset: { id: `${id}-202401`, hosted_url: `https://example.com/${id}.zip` },
    bounding_box: {
      minimum_latitude: lat - 0.5,
      maximum_latitude: lat + 0.5,
      minimum_longitude: lng - 0.5,
      maximum_longitude: lng + 0.5,
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── isTransitFeedConfigured ─────────────────────────────────────────

describe('isTransitFeedConfigured', () => {
  it('returns true when refresh token is available', () => {
    const { isTransitFeedConfigured } = getFreshModule();
    expect(isTransitFeedConfigured()).toBe(true);
  });
});

// ── discoverFeeds ───────────────────────────────────────────────────

describe('discoverFeeds', () => {
  it('fetches token then discovers GTFS feeds for a bounding box', async () => {
    const { discoverFeeds } = getFreshModule();
    const feeds = [makeFeed('mdb-100', 'MTA'), makeFeed('mdb-101', 'NJ Transit')];

    // Token fetch
    mockTokenResponse();
    // Feed discovery fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => feeds,
    });

    const result = await discoverFeeds(40.5, -74.2, 41.0, -73.7);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('mdb-100');
    expect(result[0].provider).toBe('MTA');
    expect(result[1].id).toBe('mdb-101');

    // Verify the API was called with correct params
    const feedCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(feedCallUrl).toContain('/v1/gtfs_feeds');
    expect(feedCallUrl).toContain('dataset_latitudes=40.5%2C41');
    expect(feedCallUrl).toContain('status=active');
  });

  it('throws on API error', async () => {
    const { discoverFeeds } = getFreshModule();

    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server Error',
    });

    await expect(discoverFeeds(40.5, -74.2, 41.0, -73.7)).rejects.toThrow('MobilityData API 500');
  });
});

// ── searchFeeds ─────────────────────────────────────────────────────

describe('searchFeeds', () => {
  it('searches feeds by query string', async () => {
    const { searchFeeds } = getFreshModule();
    const feeds = [makeFeed('mdb-200', 'LA Metro')];

    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: feeds }),
    });

    const result = await searchFeeds('LA Metro');

    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('LA Metro');

    const callUrl = mockFetch.mock.calls[1][0] as string;
    expect(callUrl).toContain('/v1/search');
    expect(callUrl).toContain('search_query=LA+Metro');
  });

  it('returns empty array when search has no results', async () => {
    const { searchFeeds } = getFreshModule();

    mockTokenResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = await searchFeeds('nonexistent');
    expect(result).toEqual([]);
  });
});
