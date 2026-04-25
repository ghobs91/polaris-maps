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
} from '../../src/services/poi/overtureFetcher';
import { placeToOsmPoi } from '../../src/utils/placeToOsmPoi';
import type { OverturePlace } from '../../src/types/overture';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { getDatabase } from '../../src/services/database/init';

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
  resetOverturePmtilesStateForTests();
  jest.clearAllMocks();

  const txn: { runAsync: jest.Mock } = { runAsync: jest.fn().mockResolvedValue(undefined) };
  (getDatabase as jest.Mock).mockResolvedValue({
    withExclusiveTransactionAsync: async (cb: (t: { runAsync: jest.Mock }) => Promise<void>) =>
      cb(txn),
    execAsync: jest.fn().mockResolvedValue(undefined),
  });
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
