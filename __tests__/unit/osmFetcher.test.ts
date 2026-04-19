import { fetchOsmPois, clearOsmCache } from '../../src/services/poi/osmFetcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOverpassResponse(elements: object[] = []) {
  return { elements };
}

function makeNode(id: number, name: string, lat = 40.0, lon = -74.0) {
  return {
    type: 'node',
    id,
    lat,
    lon,
    tags: { name, amenity: 'restaurant' },
  };
}

// ---------------------------------------------------------------------------
// Mocking fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  clearOsmCache();
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// fetchOsmPois — happy path
// ---------------------------------------------------------------------------

describe('fetchOsmPois', () => {
  it('parses OSM nodes into OsmPoi objects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'IHOP', 40.748, -73.985)]),
    });

    const result = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      name: 'IHOP',
      lat: 40.748,
      lng: -73.985,
      type: 'amenity',
      subtype: 'restaurant',
    });
  });

  it('parses OSM ways using the center coordinate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          {
            type: 'way',
            id: 99,
            center: { lat: 40.75, lat_center: 40.75, lon: -73.99 },
            tags: { name: 'Big Mall', shop: 'mall' },
          },
        ]),
    });

    const result = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 99, name: 'Big Mall', type: 'shop', subtype: 'mall' });
  });

  it('drops elements without a name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          { type: 'node', id: 2, lat: 40.1, lon: -74.1, tags: { amenity: 'bench' } },
        ]),
    });

    const result = await fetchOsmPois(40.0, -74.2, 40.2, -74.0);
    expect(result).toHaveLength(0);
  });

  it('throws on non-OK HTTP responses from both instances', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(fetchOsmPois(40.0, -74.0, 40.1, -73.9)).rejects.toThrow('Overpass API 429');
  });

  // ---------------------------------------------------------------------------
  // Bbox cache
  // ---------------------------------------------------------------------------

  it('returns cached results on a second call for the same bbox', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'IHOP')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    mockFetch.mockClear();
    // Same bbox — must hit cache, no network call
    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('makes a new network call for a different bbox', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Cafe')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    mockFetch.mockClear();
    // Different bbox
    await fetchOsmPois(51.5, -0.1, 51.6, 0.0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores cache for stale entries (mocked time)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Old Cafe')]),
    });

    const realDateNow = Date.now;
    // First fetch at t=0
    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    mockFetch.mockClear();

    // Advance time past the 5-minute TTL
    jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 6 * 60 * 1000);

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });

  it('cache survives minor bbox variations below the rounding threshold', async () => {
    // Two bboxes that both round to the same 2-decimal key
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Spot')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    mockFetch.mockClear();

    // Tiny panning — rounds to same key
    await fetchOsmPois(40.703, -74.002, 40.797, -73.904);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clearOsmCache forces a fresh network call', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'IHOP')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    clearOsmCache();
    mockFetch.mockClear();

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects when Overpass requests time out', async () => {
    // Both primary and fallback timeout (simulated via immediate abort)
    mockFetch.mockImplementation(() =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );

    await expect(fetchOsmPois(40.7, -74.0, 40.8, -73.9)).rejects.toThrow('aborted');
    // Should have tried both primary and fallback
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('passes AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Test')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('parses office-tagged POIs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          {
            type: 'node',
            id: 50,
            lat: 40.75,
            lon: -73.99,
            tags: { name: 'Acme Insurance', office: 'insurance' },
          },
        ]),
    });

    const result = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 50,
      name: 'Acme Insurance',
      type: 'office',
      subtype: 'insurance',
    });
  });

  it('parses craft-tagged POIs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          {
            type: 'node',
            id: 51,
            lat: 40.75,
            lon: -73.99,
            tags: { name: 'Quick Tailor', craft: 'tailor' },
          },
        ]),
    });

    const result = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 51,
      name: 'Quick Tailor',
      type: 'craft',
      subtype: 'tailor',
    });
  });

  it('parses healthcare-tagged POIs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          {
            type: 'node',
            id: 52,
            lat: 40.75,
            lon: -73.99,
            tags: { name: 'Dr. Smith DDS', healthcare: 'dentist' },
          },
        ]),
    });

    const result = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 52,
      name: 'Dr. Smith DDS',
      type: 'healthcare',
      subtype: 'dentist',
    });
  });
});
