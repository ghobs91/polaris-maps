import { osmTagsFromPoi, placeToOsmTags } from '../../src/utils/placeToOsmPoi';
import type { Place } from '../../src/models/poi';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    uuid: 'p1',
    name: 'Corner Cafe',
    category: 'cafe',
    lat: 47.6,
    lng: -122.3,
    geohash8: 'c23nb62w',
    status: 'open',
    source: 'overture',
    authorPubkey: 'key',
    signature: 'sig',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('placeToOsmTags', () => {
  it('maps category, brand, contact and address to OSM tags', () => {
    const tags = placeToOsmTags(
      makePlace({
        brandName: 'Blue Bottle',
        brandWikidata: 'Q4928910',
        phone: '+1 555 0100',
        website: 'https://example.com',
        emails: ['hi@example.com'],
        hours: 'Mo-Fr 08:00-17:00',
        addressStreet: '123 Main St, Seattle, WA 98101',
        addressCity: 'Seattle',
        addressState: 'WA',
        addressPostcode: '98101',
        addressCountry: 'US',
      }),
    );

    expect(tags).toEqual({
      name: 'Corner Cafe',
      amenity: 'cafe',
      brand: 'Blue Bottle',
      'brand:wikidata': 'Q4928910',
      phone: '+1 555 0100',
      website: 'https://example.com',
      email: 'hi@example.com',
      opening_hours: 'Mo-Fr 08:00-17:00',
      'addr:full': '123 Main St, Seattle, WA 98101',
      'addr:city': 'Seattle',
      'addr:state': 'WA',
      'addr:postcode': '98101',
      'addr:country': 'US',
    });
  });

  it('omits the invalid amenity=place fallback for the "other" category', () => {
    expect(placeToOsmTags(makePlace({ category: 'other' }))).toEqual({ name: 'Corner Cafe' });
  });

  it('never emits polaris-internal keys', () => {
    const tags = placeToOsmTags(makePlace());
    expect(Object.keys(tags).some((k) => k.startsWith('polaris:'))).toBe(false);
  });
});

describe('osmTagsFromPoi', () => {
  it('drops polaris keys and the amenity=place fallback', () => {
    const poi: OsmPoi = {
      id: -1,
      lat: 47.6,
      lng: -122.3,
      name: 'Corner Cafe',
      type: 'amenity',
      subtype: 'place',
      tags: {
        name: 'Corner Cafe',
        amenity: 'place',
        phone: '123',
        'polaris:source': 'overture',
        'polaris:uuid': 'u',
      },
    };

    expect(osmTagsFromPoi(poi)).toEqual({ name: 'Corner Cafe', phone: '123' });
  });

  it('keeps a valid primary tag and backfills it when missing', () => {
    const poi: OsmPoi = {
      id: -2,
      lat: 0,
      lng: 0,
      name: 'Bakery',
      type: 'shop',
      subtype: 'bakery',
      tags: { name: 'Bakery', 'polaris:uuid': 'u' },
    };

    expect(osmTagsFromPoi(poi)).toEqual({ name: 'Bakery', shop: 'bakery' });
  });
});
