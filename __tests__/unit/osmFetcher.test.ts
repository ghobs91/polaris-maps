import {
  fetchOsmPois,
  fetchNominatimPois,
  clearOsmCache,
  checkPoiExistsInOsm,
  clearExistenceCache,
  findOsmPlaceMatch,
  clearPlaceMatchCache,
} from '../../src/services/poi/osmFetcher';
import { isOsmNodePoi } from '../../src/utils/placeToOsmPoi';
import { __setOverpassMinIntervalMsForTests } from '../../src/services/overpassClient';

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
  __setOverpassMinIntervalMsForTests(0);
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

  it('throws when all Overpass instances return non-OK HTTP responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(fetchOsmPois(40.0, -74.0, 40.1, -73.9)).rejects.toThrow();
    // overpassClient hedges the query across all instances in parallel.
    expect(mockFetch).toHaveBeenCalledTimes(3);
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

    // overpassClient fires all instances in parallel per fetch.
    expect(mockFetch).toHaveBeenCalledTimes(3);
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
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 6 * 60 * 1000);

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    nowSpy.mockRestore();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('cache serves a viewport that sits inside an already-fetched box', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Spot')]),
    });

    await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    mockFetch.mockClear();

    // Tiny panning that stays inside the fetched box (same rounded key).
    await fetchOsmPois(40.703, -73.998, 40.797, -73.902);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not answer a larger bbox from a smaller cached one in the same grid cell', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeOverpassResponse([makeNode(1, 'Lone Diner')]),
    });

    // Street-level viewport: a few hundred metres inside one grid cell.
    await fetchOsmPois(40.746, -73.994, 40.748, -73.992);
    mockFetch.mockClear();

    // A bigger view in the *same* rounded 2-decimal cell: the cached
    // street-level result (one restaurant) must not answer it.
    await fetchOsmPois(40.7451, -73.9949, 40.7549, -73.9851);
    expect(mockFetch).toHaveBeenCalledTimes(3);
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
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects when all Overpass requests time out', async () => {
    // Every instance times out (simulated via immediate abort)
    mockFetch.mockImplementation(() =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );

    await expect(fetchOsmPois(40.7, -74.0, 40.8, -73.9)).rejects.toThrow();
    // Should have tried all hedged instances
    expect(mockFetch).toHaveBeenCalledTimes(3);
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

// ---------------------------------------------------------------------------
// checkPoiExistsInOsm — pre-submission existence guard
// ---------------------------------------------------------------------------

describe('checkPoiExistsInOsm', () => {
  const LAT = 40.748;
  const LNG = -73.985;

  function overpass(elements: object[]) {
    return { ok: true, json: async () => ({ elements }) };
  }

  function node(id: number, tags: Record<string, string>, lat = LAT, lon = LNG) {
    return { type: 'node', id, lat, lon, tags };
  }

  function firstQuery(): string {
    const body = (mockFetch.mock.calls[0] as any[])[1]?.body as string;
    return decodeURIComponent(body.replace(/^data=/, ''));
  }

  beforeEach(() => {
    clearExistenceCache();
    mockFetch.mockReset();
  });

  it('returns true when a matching named POI exists nearby', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Starbucks', amenity: 'cafe' })]));
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(true);
  });

  it('matches a way using its center coordinate', async () => {
    mockFetch.mockResolvedValue(
      overpass([
        {
          type: 'way',
          id: 99,
          center: { lat: LAT, lon: LNG },
          tags: { name: 'Starbucks', amenity: 'cafe' },
        },
      ]),
    );
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(true);
  });

  it('matches a relation (multipolygon venues)', async () => {
    mockFetch.mockResolvedValue(
      overpass([
        {
          type: 'relation',
          id: 5,
          center: { lat: LAT, lon: LNG },
          tags: { name: 'Starbucks', amenity: 'cafe' },
        },
      ]),
    );
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(true);
  });

  it('recognises fuzzy name variants', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Starbucks Coffee', amenity: 'cafe' })]));
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(true);
  });

  it('recognises a brand:wikidata match even with a different name', async () => {
    mockFetch.mockResolvedValue(
      overpass([node(1, { name: 'Bucks Coffee', amenity: 'cafe', 'brand:wikidata': 'Q37158' })]),
    );
    expect(
      await checkPoiExistsInOsm(LAT, LNG, "Joe's Coffee", {
        amenity: 'cafe',
        'brand:wikidata': 'Q37158',
      }),
    ).toBe(true);
  });

  it('returns false when the nearby candidate has a different name', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Subway', amenity: 'fast_food' })]));
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(false);
  });

  it('returns false when a same-name candidate is out of range', async () => {
    mockFetch.mockResolvedValue(
      overpass([node(1, { name: 'Starbucks', amenity: 'cafe' }, 40.8005, LNG)]),
    );
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBe(false);
  });

  it('returns false when the name is similar but the category conflicts', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Golden Dragons', shop: 'hardware' })]));
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Golden Dragon', { amenity: 'restaurant' })).toBe(
      false,
    );
  });

  it('returns false when no candidates exist', async () => {
    mockFetch.mockResolvedValue(overpass([]));
    expect(await checkPoiExistsInOsm(LAT, LNG, 'Unknown Cafe')).toBe(false);
  });

  it('returns false for empty or whitespace names without querying', async () => {
    expect(await checkPoiExistsInOsm(LAT, LNG, '')).toBe(false);
    expect(await checkPoiExistsInOsm(LAT, LNG, '   ')).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queries nwr with all name keys and a category-aware radius', async () => {
    mockFetch.mockResolvedValue(overpass([]));
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    let query = firstQuery();
    expect(query).toContain('nwr["name"~"starbucks",i]');
    expect(query).toContain('nwr["brand"~"starbucks",i]');
    expect(query).toContain('around:120,');
    expect(query).toContain('out center tags;');

    mockFetch.mockClear();
    clearExistenceCache();
    mockFetch.mockResolvedValue(overpass([]));
    await checkPoiExistsInOsm(LAT, LNG, 'Central Park', { leisure: 'park' });
    query = firstQuery();
    expect(query).toContain('around:250,');
  });

  it('caches results with a TTL', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Starbucks', amenity: 'cafe' })]));
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    mockFetch.mockClear();
    const r2 = await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    expect(r2).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps a distinct cache entry per category', async () => {
    mockFetch.mockResolvedValue(overpass([]));
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    mockFetch.mockClear();
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { shop: 'coffee' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rounds coordinates to ~11m in the cache key', async () => {
    mockFetch.mockResolvedValue(overpass([]));
    await checkPoiExistsInOsm(40.748123, -73.985456, 'Starbucks', { amenity: 'cafe' });
    mockFetch.mockClear();
    await checkPoiExistsInOsm(40.748129, -73.98546, 'starbucks', { amenity: 'cafe' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws on Overpass errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    await expect(checkPoiExistsInOsm(LAT, LNG, 'Starbucks')).rejects.toThrow();
  });

  it('clearExistenceCache forces a fresh network call', async () => {
    mockFetch.mockResolvedValue(overpass([]));
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    clearExistenceCache();
    mockFetch.mockClear();
    await checkPoiExistsInOsm(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    // overpassClient fires to 3 Overpass instances in parallel
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// findOsmPlaceMatch — resolving a non-OSM place to an editable OSM element
// ---------------------------------------------------------------------------

describe('findOsmPlaceMatch', () => {
  const LAT = 40.748;
  const LNG = -73.985;

  function overpass(elements: object[]) {
    return { ok: true, json: async () => ({ elements }) };
  }

  function node(id: number, tags: Record<string, string>) {
    return { type: 'node', id, lat: LAT, lon: LNG, tags };
  }

  function way(id: number, tags: Record<string, string>) {
    return { type: 'way', id, center: { lat: LAT, lon: LNG }, tags };
  }

  beforeEach(() => {
    clearPlaceMatchCache();
    clearExistenceCache();
    mockFetch.mockReset();
  });

  it('resolves a mapped place to its OSM node', async () => {
    mockFetch.mockResolvedValue(
      overpass([node(42, { name: 'Your Mothers House', amenity: 'restaurant' })]),
    );

    expect(
      await findOsmPlaceMatch(LAT, LNG, 'Your Mothers House', { amenity: 'restaurant' }),
    ).toEqual({ type: 'node', id: 42 });
  });

  it('prefers a node over a way when both match', async () => {
    mockFetch.mockResolvedValue(
      overpass([
        way(99, { name: 'Starbucks', amenity: 'cafe' }),
        node(7, { name: 'Starbucks', amenity: 'cafe' }),
      ]),
    );

    expect(await findOsmPlaceMatch(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toEqual({
      type: 'node',
      id: 7,
    });
  });

  it('reports a way-only match so callers know it is mapped but not node-editable', async () => {
    mockFetch.mockResolvedValue(overpass([way(99, { name: 'Starbucks', amenity: 'cafe' })]));

    expect(await findOsmPlaceMatch(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toEqual({
      type: 'way',
      id: 99,
    });
  });

  it('returns null when nothing matches confidently', async () => {
    mockFetch.mockResolvedValue(overpass([node(1, { name: 'Subway', amenity: 'fast_food' })]));

    expect(await findOsmPlaceMatch(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toBeNull();
  });

  it('returns null for an empty name without querying', async () => {
    expect(await findOsmPlaceMatch(LAT, LNG, '   ')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caches the resolved match', async () => {
    mockFetch.mockResolvedValue(overpass([node(42, { name: 'Starbucks', amenity: 'cafe' })]));
    await findOsmPlaceMatch(LAT, LNG, 'Starbucks', { amenity: 'cafe' });
    mockFetch.mockClear();

    expect(await findOsmPlaceMatch(LAT, LNG, 'Starbucks', { amenity: 'cafe' })).toEqual({
      type: 'node',
      id: 42,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Element-type and source tagging (id-space guards)
// ---------------------------------------------------------------------------

describe('POI id-space tagging', () => {
  beforeEach(() => {
    clearOsmCache();
    mockFetch.mockReset();
  });

  it('tags Overpass nodes and ways with their element type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOverpassResponse([
          makeNode(1, 'IHOP'),
          {
            type: 'way',
            id: 2,
            center: { lat: 40.0, lon: -74.0 },
            tags: { name: 'Mall Cafe', amenity: 'cafe' },
          },
        ]),
    });

    const pois = await fetchOsmPois(40.7, -74.0, 40.8, -73.9);
    expect(pois.find((p) => p.id === 1)?.tags['polaris:osmType']).toBe('node');
    expect(pois.find((p) => p.id === 2)?.tags['polaris:osmType']).toBe('way');
  });

  it('tags Nominatim POIs so their place_id is never used as an OSM id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 123456,
          lat: '40.0',
          lon: '-74.0',
          display_name: 'Corner Cafe, Main St, New York',
          type: 'cafe',
          class: 'amenity',
        },
      ],
    });

    const pois = await fetchNominatimPois(40.7, -74.0, 40.8, -73.9);
    expect(pois[0]?.tags['polaris:source']).toBe('nominatim');
    expect(isOsmNodePoi(pois[0]!)).toBe(false);
  });
});
