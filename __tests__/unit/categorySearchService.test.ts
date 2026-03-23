// Mock native/expo modules
jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));
jest.mock('../../src/services/gun/init', () => ({
  getGun: jest.fn(),
}));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn(),
}));

import { searchByCategory } from '../../src/services/poi/categorySearchService';
import * as poiService from '../../src/services/poi/poiService';
import * as osmFetcher from '../../src/services/poi/osmFetcher';
import type { Place } from '../../src/models/poi';

// ---------------------------------------------------------------------------
// Mock global.fetch for Nominatim fallback calls
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    uuid: 'place-001',
    name: 'Test Coffee',
    category: 'cafe',
    lat: 40.748,
    lng: -73.985,
    geohash8: 'dr5rugk0',
    status: 'open',
    source: 'overture',
    authorPubkey: '',
    signature: '',
    createdAt: 1700000000,
    updatedAt: 1700000000,
    reviewCount: 0,
    ...overrides,
  };
}

function makeOsmPoi(id: number, name: string, lat: number, lng: number) {
  return {
    id,
    lat,
    lng,
    name,
    type: 'amenity',
    subtype: 'cafe',
    tags: { name, amenity: 'cafe' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchByCategory', () => {
  const bbox = { south: 40.7, west: -74.0, north: 40.8, east: -73.9 };

  beforeEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
    // Default: Nominatim returns empty results
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('returns null for queries that are not category-related', async () => {
    const result = await searchByCategory(
      '123 Main Street',
      bbox.south,
      bbox.west,
      bbox.north,
      bbox.east,
    );
    expect(result).toBeNull();
  });

  it('returns local Overture data as primary when sufficient results exist', async () => {
    const places = Array.from({ length: 10 }, (_, i) =>
      makePlace({ uuid: `place-${i}`, name: `Coffee ${i}`, lat: 40.74 + i * 0.001 }),
    );
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue(places);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    expect(result!.localPrimary).toBe(true);
    expect(result!.categories).toEqual(['cafe']);
    expect(result!.pois.length).toBe(10);
    // Should NOT call Overpass when local data is sufficient
    expect(osmFetcher.fetchOsmPoisByTags).not.toHaveBeenCalled();
  });

  it('falls back to Overpass when local data is insufficient', async () => {
    const places = [makePlace({ uuid: 'place-1', name: 'Solo Coffee' })];
    const overpassPois = [
      makeOsmPoi(100, 'Starbucks', 40.75, -73.98),
      makeOsmPoi(101, 'Blue Bottle', 40.751, -73.979),
    ];

    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue(places);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue(overpassPois);

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    expect(result!.localPrimary).toBe(false);
    expect(result!.pois.length).toBe(3); // 1 local + 2 overpass
    expect(osmFetcher.fetchOsmPoisByTags).toHaveBeenCalled();
  });

  it('deduplicates POIs by name + proximity across sources', async () => {
    const places = [makePlace({ uuid: 'place-1', name: 'Starbucks', lat: 40.75, lng: -73.98 })];
    // Same name + very close location
    const overpassPois = [makeOsmPoi(100, 'Starbucks', 40.7501, -73.9801)];

    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue(places);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue(overpassPois);

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    // Should deduplicate — only 1 result (local wins)
    expect(result!.pois.length).toBe(1);
  });

  it('handles Overpass failure gracefully, falling through to Nominatim', async () => {
    const places = [makePlace({ uuid: 'place-1', name: 'Solo Coffee' })];
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue(places);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockRejectedValue(new Error('Network error'));
    // Nominatim also returns empty
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    expect(result!.pois.length).toBe(1); // only local data
    expect(result!.localPrimary).toBe(false);
  });

  it('returns Nominatim results when both local and Overpass are empty', async () => {
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue([]);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);

    // Nominatim returns a cafe result
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 500,
          lat: '40.755',
          lon: '-73.975',
          display_name: 'Blue Bottle Coffee, 5th Ave, Manhattan, NY',
          type: 'cafe',
          class: 'amenity',
          address: { road: '5th Ave', city: 'New York' },
        },
      ],
    });

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    expect(result!.pois.length).toBe(1);
    expect(result!.pois[0]).toMatchObject({
      id: 500,
      name: 'Blue Bottle Coffee',
      lat: 40.755,
      lng: -73.975,
      type: 'amenity',
      subtype: 'cafe',
    });
    expect(result!.localPrimary).toBe(false);
  });

  it('filters out non-POI Nominatim results (e.g. admin boundaries)', async () => {
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue([]);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 600,
          lat: '33.5',
          lon: '-86.0',
          display_name: 'Coffee County, Alabama, US',
          type: 'administrative',
          class: 'boundary',
        },
        {
          place_id: 601,
          lat: '40.755',
          lon: '-73.975',
          display_name: 'Starbucks, Broadway, NY',
          type: 'cafe',
          class: 'amenity',
        },
      ],
    });

    const result = await searchByCategory('coffee', bbox.south, bbox.west, bbox.north, bbox.east);

    expect(result).not.toBeNull();
    // Only the Starbucks (amenity), not Coffee County (boundary)
    expect(result!.pois.length).toBe(1);
    expect(result!.pois[0].name).toBe('Starbucks');
  });

  it('resolves multi-category queries correctly', async () => {
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue([]);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);

    const result = await searchByCategory('food', bbox.south, bbox.west, bbox.north, bbox.east);

    // "food" resolves to restaurant, fast_food, cafe, bakery
    expect(result).not.toBeNull();
    expect(result!.categories).toEqual(['restaurant', 'fast_food', 'cafe', 'bakery']);
  });

  it('passes cuisine hint to Nominatim for cuisine-specific queries', async () => {
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue([]);
    jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 700,
          lat: '40.755',
          lon: '-73.975',
          display_name: 'Golden Dragon, Main St, Levittown, NY',
          type: 'restaurant',
          class: 'amenity',
          address: { road: 'Main St', city: 'Levittown' },
        },
      ],
    });

    const result = await searchByCategory(
      'chinese food',
      bbox.south,
      bbox.west,
      bbox.north,
      bbox.east,
    );

    expect(result).not.toBeNull();
    expect(result!.pois.length).toBe(1);
    expect(result!.pois[0].name).toBe('Golden Dragon');

    // Verify Nominatim was called with cuisine-specific query
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('chinese+restaurant');
  });

  it('adds cuisine tag to Overpass queries for cuisine-specific searches', async () => {
    jest.spyOn(poiService, 'searchPlacesByCategory').mockResolvedValue([]);
    const spy = jest.spyOn(osmFetcher, 'fetchOsmPoisByTags').mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });

    await searchByCategory('chinese food', bbox.south, bbox.west, bbox.north, bbox.east);

    // Overpass should include cuisine=chinese tag
    const tagPairs = spy.mock.calls[0]?.[4] as Array<[string, string]>;
    expect(tagPairs).toBeDefined();
    expect(tagPairs).toContainEqual(['cuisine', 'chinese']);
  });
});
