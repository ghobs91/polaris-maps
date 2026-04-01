// Mock native/expo modules that can't parse in Node
jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));

import {
  overtureFeatureToPlace,
  mapOvertureCategory,
} from '../../src/services/poi/overtureFetcher';
import { placeToOsmPoi } from '../../src/utils/placeToOsmPoi';
import type { OverturePlace } from '../../src/types/overture';

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
