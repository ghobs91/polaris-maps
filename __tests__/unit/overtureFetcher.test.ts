// Mock native/expo modules that can't parse in Node
jest.mock('expo-sqlite', () => ({}));
jest.mock('pmtiles', () => ({ PMTiles: jest.fn() }));
jest.mock('@mapbox/vector-tile', () => ({ VectorTile: jest.fn() }));
jest.mock('pbf', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));

import {
  fetchOverturePlaces,
  overtureFeatureToPlace,
  overtureFeatureFromVectorTileGeoJSON,
  mapOvertureCategory,
  resetOverturePmtilesStateForTests,
  extractYelpListingUrl,
  selectTilesForBounds,
} from '../../src/services/poi/overtureFetcher';
import { placeToOsmPoi } from '../../src/utils/placeToOsmPoi';
import type { OverturePlace } from '../../src/types/overture';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { getDatabase } from '../../src/services/database/init';
import { cacheGet, cacheSet, clearSearchCache } from '../../src/services/search/searchCache';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOverturePlace(overrides: Partial<OverturePlace['properties']> = {}): OverturePlace {
  return {
    type: 'Feature',
    id: '99003ee6-e75b-4dd6-8a8a-53a5a716c50d',
    geometry: { type: 'Point', coordinates: [-73.985, 40.748] },
    properties: {
      id: '99003ee6-e75b-4dd6-8a8a-53a5a716c50d',
      names: { primary: 'IHOP' },
      categories: { primary: 'restaurant', alternate: ['pancake_restaurant'] },
      basic_category: 'restaurant',
      confidence: 0.92,
      websites: ['https://restaurants.ihop.com'],
      phones: ['+15165975490'],
      addresses: [
        {
          freeform: '2935 Hempstead Turnpike',
          locality: 'Levittown',
          postcode: '11756',
          region: 'NY',
          country: 'US',
        },
      ],
      operating_status: 'open',
      ...overrides,
    },
  };
}

beforeEach(() => {
  // Pin the archive URL so fetchOverturePlaces doesn't hit the STAC catalog.
  process.env.EXPO_PUBLIC_OVERTURE_PLACES_PM_TILES_URL = 'https://overture.test/places.pmtiles';
  resetOverturePmtilesStateForTests();
  clearSearchCache();
  jest.clearAllMocks();

  const txn: { runAsync: jest.Mock; getAllAsync: jest.Mock } = {
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    withExclusiveTransactionAsync: async (
      cb: (t: { runAsync: jest.Mock; getAllAsync: jest.Mock }) => Promise<void>,
    ) => cb(txn),
    execAsync: jest.fn().mockResolvedValue(undefined),
    getFirstAsync: jest.fn().mockResolvedValue({ n: 0 }),
  });
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_OVERTURE_PLACES_PM_TILES_URL;
});

// ---------------------------------------------------------------------------
// overtureFeatureToPlace
// ---------------------------------------------------------------------------

describe('overtureFeatureToPlace', () => {
  it('converts a well-formed Overture place to a Place', () => {
    const result = overtureFeatureToPlace(makeOverturePlace());
    expect(result).not.toBeNull();
    expect(result!.name).toBe('IHOP');
    expect(result!.category).toBe('restaurant');
    expect(result!.lat).toBeCloseTo(40.748);
    expect(result!.lng).toBeCloseTo(-73.985);
    expect(result!.phone).toBe('+15165975490');
    expect(result!.website).toBe('https://restaurants.ihop.com');
    expect(result!.addressStreet).toBe('2935 Hempstead Turnpike');
    expect(result!.addressCity).toBe('Levittown');
    expect(result!.addressPostcode).toBe('11756');
    expect(result!.addressState).toBe('NY');
    expect(result!.addressCountry).toBe('US');
    expect(result!.status).toBe('open');
    expect(result!.source).toBe('overture');
    expect(result!.uuid).toBe('99003ee6-e75b-4dd6-8a8a-53a5a716c50d');
  });

  it('returns null for features without a name', () => {
    const result = overtureFeatureToPlace(makeOverturePlace({ names: { primary: undefined } }));
    expect(result).toBeNull();
  });

  it('returns null for low-confidence features', () => {
    const result = overtureFeatureToPlace(makeOverturePlace({ confidence: 0.2 }));
    expect(result).toBeNull();
  });

  it('maps temporarily_closed status', () => {
    const result = overtureFeatureToPlace(
      makeOverturePlace({ operating_status: 'temporarily_closed' }),
    );
    expect(result!.status).toBe('closed_temporarily');
  });

  it('maps permanently_closed status', () => {
    const result = overtureFeatureToPlace(
      makeOverturePlace({ operating_status: 'permanently_closed', confidence: 0.6 }),
    );
    expect(result!.status).toBe('closed_permanently');
  });

  it('handles missing optional fields gracefully', () => {
    const result = overtureFeatureToPlace(
      makeOverturePlace({
        phones: undefined,
        websites: undefined,
        addresses: undefined,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.phone).toBeUndefined();
    expect(result!.website).toBeUndefined();
    expect(result!.addressStreet).toBeUndefined();
  });

  it('generates a geohash8 for the coordinates', () => {
    const result = overtureFeatureToPlace(makeOverturePlace());
    expect(result!.geohash8).toBeDefined();
    expect(result!.geohash8.length).toBe(8);
  });

  it('extracts a canonical Yelp listing from socials/websites', () => {
    const result = overtureFeatureToPlace(
      makeOverturePlace({
        websites: ['https://restaurants.ihop.com'],
        socials: ['https://www.yelp.com/biz/ihop-levittown-3?utm_source=x#reviews'],
      }),
    );
    expect(result!.yelp).toBe('https://www.yelp.com/biz/ihop-levittown-3');
  });

  it('leaves yelp undefined when no Yelp listing is present', () => {
    expect(overtureFeatureToPlace(makeOverturePlace())!.yelp).toBeUndefined();
  });
});

describe('extractYelpListingUrl', () => {
  it('returns the first canonical Yelp business URL, skipping other links', () => {
    expect(
      extractYelpListingUrl([
        'https://facebook.com/foo',
        'https://yelp.ca/biz/foo',
        'https://www.yelp.com/biz/foo-bar#reviews',
      ]),
    ).toBe('https://www.yelp.com/biz/foo-bar');
  });

  it('ignores Yelp search URLs and non-Yelp links', () => {
    expect(
      extractYelpListingUrl(['https://www.yelp.com/search?find_desc=foo', 'https://example.com']),
    ).toBeUndefined();
    expect(extractYelpListingUrl(undefined)).toBeUndefined();
  });
});

describe('overtureFeatureFromVectorTileGeoJSON', () => {
  it('parses stringified PMTiles properties into an Overture feature', () => {
    const feature = overtureFeatureFromVectorTileGeoJSON({
      type: 'Feature',
      id: 123,
      geometry: { type: 'Point', coordinates: [-73.52854832, 40.72402722] },
      properties: {
        id: 'f4a35e34-75f4-45d2-9ac3-033d50242880',
        '@name': 'Calda Pizzeria',
        names: '{"primary":"Calda Pizzeria","common":null,"rules":null}',
        categories: '{"primary":"pizza_restaurant","alternate":["italian_restaurant"]}',
        confidence: 0.9793949723243713,
        addresses:
          '[{"freeform":"2890 Hempstead Tpke","locality":"Hempstead","postcode":"11756-1356","region":"NY","country":"US"}]',
      },
    } as any);

    expect(feature).not.toBeNull();
    expect(feature!.properties.names?.primary).toBe('Calda Pizzeria');
    expect(feature!.properties.categories?.primary).toBe('pizza_restaurant');
    expect(feature!.properties.addresses?.[0]?.freeform).toBe('2890 Hempstead Tpke');
  });
});

describe('fetchOverturePlaces', () => {
  it('reuses decoded PMTiles tile data across overlapping bbox fetches', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
    (PMTiles as jest.Mock).mockImplementation(() => ({ getZxy: mockGetZxy }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));

    const geojsonFeature = {
      type: 'Feature',
      id: 123,
      geometry: { type: 'Point', coordinates: [-73.52854832, 40.72402722] },
      properties: {
        id: 'f4a35e34-75f4-45d2-9ac3-033d50242880',
        names: '{"primary":"Calda Pizzeria"}',
        categories: '{"primary":"pizza_restaurant"}',
        confidence: 0.98,
      },
    };
    const mockLayer = {
      length: 1,
      feature: jest.fn(() => ({ toGeoJSON: jest.fn(() => geojsonFeature) })),
    };
    (VectorTile as jest.Mock).mockImplementation(() => ({ layers: { place: mockLayer } }));

    const first = await fetchOverturePlaces(40.7239, -73.5287, 40.7243, -73.5282, 50);
    const second = await fetchOverturePlaces(40.72395, -73.52865, 40.72435, -73.52815, 50);

    expect(first.map((place) => place.name)).toEqual(['Calda Pizzeria']);
    expect(second.map((place) => place.name)).toEqual(['Calda Pizzeria']);
    expect(mockGetZxy).toHaveBeenCalledTimes(1);
  });

  it('clamps the requested tile zoom to the archive maxZoom', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue({ data: new Uint8Array([1]) });
    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: mockGetZxy,
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));
    (VectorTile as jest.Mock).mockImplementation(() => ({ layers: {} }));

    // Requested zoom comes from the tile coords passed to getZxy.
    await fetchOverturePlaces(40.7239, -73.5287, 40.7243, -73.5282, 50);

    expect(mockGetZxy).toHaveBeenCalled();
    expect(mockGetZxy.mock.calls[0][0]).toBe(14);
  });

  it('caps tiles fetched for a wide viewport', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue(undefined);
    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: mockGetZxy,
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));
    (VectorTile as jest.Mock).mockImplementation(() => ({ layers: {} }));

    // ~0.9° x 1.0° spans thousands of z14 tiles.
    await fetchOverturePlaces(40.0, -74.5, 40.9, -73.5, 420);

    expect(mockGetZxy.mock.calls.length).toBeGreaterThan(0);
    expect(mockGetZxy.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('samples at most a bounded number of features per tile', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: mockGetZxy,
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));

    const geojsonFeature = {
      type: 'Feature',
      id: 123,
      geometry: { type: 'Point', coordinates: [-73.52854832, 40.72402722] },
      properties: {
        id: 'f4a35e34-75f4-45d2-9ac3-033d50242880',
        names: '{"primary":"Calda Pizzeria"}',
        categories: '{"primary":"pizza_restaurant"}',
        confidence: 0.98,
      },
    };
    const mockFeature = jest.fn(() => ({ toGeoJSON: jest.fn(() => geojsonFeature) }));
    (VectorTile as jest.Mock).mockImplementation(() => ({
      layers: { place: { length: 50_000, feature: mockFeature } },
    }));

    await fetchOverturePlaces(40.7239, -73.5287, 40.7243, -73.5282, 50);

    expect(mockFeature.mock.calls.length).toBeLessThanOrEqual(4_000);
  });

  it('resolves the current release from the STAC catalog', async () => {
    delete process.env.EXPO_PUBLIC_OVERTURE_PLACES_PM_TILES_URL;
    resetOverturePmtilesStateForTests();

    const originalFetch = (global as { fetch?: unknown }).fetch;
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ latest: '2026-10-21.0' }),
    });

    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: jest.fn().mockResolvedValue(undefined),
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));
    (VectorTile as jest.Mock).mockImplementation(() => ({ layers: {} }));

    try {
      await fetchOverturePlaces(40.7239, -73.5287, 40.7243, -73.5282, 50);
      expect(PMTiles).toHaveBeenCalledWith(
        'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-10-21.0/places.pmtiles',
      );
    } finally {
      (global as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it('caps PMTiles requests for a wide search box', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue({ data: new Uint8Array([1]) });
    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: mockGetZxy,
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));
    (VectorTile as jest.Mock).mockImplementation(() => ({ layers: {} }));

    // ~18 km box: 60+ z14 tiles before the cap.
    await fetchOverturePlaces(40.64, -73.5, 40.8, -73.34, 50);

    expect(mockGetZxy.mock.calls.length).toBeLessThanOrEqual(16);
    expect(mockGetZxy.mock.calls.length).toBeGreaterThan(0);
  });

  it('does not invalidate overlapping search-cache entries on the search path', async () => {
    const mockGetZxy = jest.fn().mockResolvedValue({ data: new Uint8Array([1]) });
    (PMTiles as jest.Mock).mockImplementation(() => ({
      getHeader: jest.fn().mockResolvedValue({ maxZoom: 14 }),
      getZxy: mockGetZxy,
    }));
    (Pbf as jest.Mock).mockImplementation(() => ({}));
    const geojsonFeature = {
      type: 'Feature',
      id: 123,
      geometry: { type: 'Point', coordinates: [-73.52854832, 40.72402722] },
      properties: {
        id: 'f4a35e34-75f4-45d2-9ac3-033d50242880',
        names: '{"primary":"Calda Pizzeria"}',
        categories: '{"primary":"pizza_restaurant"}',
        confidence: 0.98,
      },
    };
    (VectorTile as jest.Mock).mockImplementation(() => ({
      layers: {
        place: {
          length: 1,
          feature: jest.fn(() => ({ toGeoJSON: jest.fn(() => geojsonFeature) })),
        },
      },
    }));

    const bounds = { south: 40.7239, north: 40.7243, west: -73.5287, east: -73.5282 };
    cacheSet('photon|michaels', [{ name: 'Michaels' }], { bounds });

    const places = await fetchOverturePlaces(
      bounds.south,
      bounds.west,
      bounds.north,
      bounds.east,
      50,
    );

    expect(places).toHaveLength(1);
    expect(cacheGet('photon|michaels')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// selectTilesForBounds
// ---------------------------------------------------------------------------

describe('selectTilesForBounds', () => {
  it('requests every tile when the box fits under the cap', () => {
    const { zoom, tiles } = selectTilesForBounds(40.7239, -73.5287, 40.7243, -73.5282, 14, 16);
    expect(zoom).toBe(14);
    expect(tiles.length).toBeLessThanOrEqual(16);
    expect(tiles.length).toBeGreaterThan(0);
  });

  it('caps a wide box to the tiles nearest its centre', () => {
    const { zoom, tiles } = selectTilesForBounds(40.64, -73.5, 40.8, -73.34, 14, 16);

    expect(zoom).toBe(14);
    expect(tiles).toHaveLength(16);
    // 0.16° ≈ 7 z14 tiles across; a centre-first subset must stay near 40.72/-73.42.
    const centerX = Math.floor(((-73.42 + 180) / 360) * Math.pow(2, 14));
    const xs = tiles.map((tile) => tile.x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(centerX);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(centerX);
  });
});

// ---------------------------------------------------------------------------
// mapOvertureCategory
// ---------------------------------------------------------------------------

describe('mapOvertureCategory', () => {
  it('maps basic_category to Polaris category', () => {
    expect(mapOvertureCategory(makeOverturePlace({ basic_category: 'cafe' }))).toBe('cafe');
  });

  it('falls back to categories.primary', () => {
    const feat = makeOverturePlace({
      basic_category: undefined,
      categories: { primary: 'hotel' },
    });
    expect(mapOvertureCategory(feat)).toBe('hotel');
  });

  it('walks taxonomy hierarchy from specific to broad', () => {
    const feat = makeOverturePlace({
      basic_category: undefined,
      categories: undefined,
      taxonomy: {
        hierarchy: ['food_and_drink', 'restaurant', 'cafe'],
        primary: 'cafe',
      },
    });
    expect(mapOvertureCategory(feat)).toBe('cafe');
  });

  it('returns "other" for unknown categories', () => {
    const feat = makeOverturePlace({
      basic_category: 'interstellar_docking_bay',
      categories: { primary: 'space_port' },
    });
    expect(mapOvertureCategory(feat)).toBe('other');
  });

  it('maps "deli" basic_category to deli', () => {
    expect(mapOvertureCategory(makeOverturePlace({ basic_category: 'deli' }))).toBe('deli');
  });

  it('maps "delicatessen" basic_category to deli', () => {
    expect(mapOvertureCategory(makeOverturePlace({ basic_category: 'delicatessen' }))).toBe('deli');
  });

  it('maps "sandwich_shop" basic_category to deli', () => {
    expect(mapOvertureCategory(makeOverturePlace({ basic_category: 'sandwich_shop' }))).toBe(
      'deli',
    );
  });

  it('maps "bagel_shop" basic_category to deli', () => {
    expect(mapOvertureCategory(makeOverturePlace({ basic_category: 'bagel_shop' }))).toBe('deli');
  });
});

// ---------------------------------------------------------------------------
// placeToOsmPoi (round-trip)
// ---------------------------------------------------------------------------

describe('placeToOsmPoi', () => {
  it('converts a Place to OsmPoi with correct type/subtype', () => {
    const place = overtureFeatureToPlace(makeOverturePlace())!;
    const poi = placeToOsmPoi(place);

    expect(poi.name).toBe('IHOP');
    expect(poi.lat).toBeCloseTo(40.748);
    expect(poi.lng).toBeCloseTo(-73.985);
    expect(poi.type).toBe('amenity');
    expect(poi.subtype).toBe('restaurant');
    // Negative ID to avoid OSM collision
    expect(poi.id).toBeLessThan(0);
  });

  it('includes phone and website in tags', () => {
    const place = overtureFeatureToPlace(makeOverturePlace())!;
    const poi = placeToOsmPoi(place);
    expect(poi.tags['phone']).toBe('+15165975490');
    expect(poi.tags['website']).toBe('https://restaurants.ihop.com');
  });

  it('includes polaris:source and polaris:uuid tags', () => {
    const place = overtureFeatureToPlace(makeOverturePlace())!;
    const poi = placeToOsmPoi(place);
    expect(poi.tags['polaris:source']).toBe('overture');
    expect(poi.tags['polaris:uuid']).toBe('99003ee6-e75b-4dd6-8a8a-53a5a716c50d');
  });
});
