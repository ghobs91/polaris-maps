import {
  destinationToGeocodingResult,
  geocodingResultToSearchResult,
  isGenericNearbyQuery,
  isSameDestination,
  preferNearbyResults,
  selectSearchPins,
  shouldFrameResults,
} from '../../src/components/map/floatingSearchPanelHelpers';
import type { GeocodingResult } from '../../src/services/geocoding/geocodingService';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

function poi(id: number, name: string, lat: number, lng: number): OsmPoi {
  return { id, name, lat, lng, type: 'shop', subtype: 'bakery', tags: { name } };
}

describe('floatingSearchPanelHelpers', () => {
  it('builds a geocoding result from a directions target', () => {
    expect(
      destinationToGeocodingResult({
        lat: 40.748433,
        lng: -73.985664,
        name: '350 5th Ave',
      }),
    ).toEqual({
      entry: {
        id: 0,
        text: '350 5th Ave',
        type: 'place',
        housenumber: null,
        street: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        lat: 40.748433,
        lng: -73.985664,
      },
      rank: 0,
    });
  });

  it('adapts a geocoding result for the shared row with joined address lines', () => {
    const adapted = geocodingResultToSearchResult({
      entry: {
        id: 7,
        text: '350 5th Ave',
        type: 'address',
        housenumber: '350',
        street: '5th Ave',
        city: 'New York',
        state: 'NY',
        postcode: '10118',
        country: 'USA',
        lat: 40.748433,
        lng: -73.985664,
      },
      rank: 42,
    });

    expect(adapted).toMatchObject({
      name: '350 5th Ave',
      subtitle: '350 5th Ave, New York, NY, USA',
      type: 'address',
      score: 42,
      distanceKm: 0,
    });
    expect(adapted.poi).toBeUndefined();
  });

  it('preserves the transit-station variant', () => {
    const station: GeocodingResult = {
      entry: {
        id: 9,
        text: 'Grand Central',
        type: 'station',
        housenumber: null,
        street: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        lat: 40.7527,
        lng: -73.9772,
      },
      rank: 5,
    };

    const adapted = geocodingResultToSearchResult(station);

    expect(adapted.osmType).toBe('railway');
    expect(adapted.osmSubtype).toBe('station');
    expect(adapted.subtitle).toBe('Transit Station');
  });

  it('matches destinations by coordinates', () => {
    const result = destinationToGeocodingResult({
      lat: 40.748433,
      lng: -73.985664,
      name: '350 5th Ave',
    });

    expect(
      isSameDestination(result, {
        lat: 40.748433,
        lng: -73.985664,
        name: 'Empire State Building',
      }),
    ).toBe(true);
    expect(
      isSameDestination(result, {
        lat: 37.785834,
        lng: -122.406417,
        name: 'Dropped Pin',
      }),
    ).toBe(false);
  });

  describe('pin selection and camera fit', () => {
    // User in Westbury, NY; Manhattan bagels are ~40 km away.
    const westbury = { lat: 40.7557, lng: -73.5876 };
    const westburyBagels = [
      poi(1, 'Westbury Bagels', 40.756, -73.588),
      poi(2, 'Carle Place Bagels', 40.7503, -73.6042),
      poi(3, 'Hicksville Bagels', 40.7684, -73.5251),
    ];
    const manhattanBagels = [
      poi(11, 'Midtown Bagels', 40.7549, -73.984),
      poi(12, 'Village Bagels', 40.734, -74.0),
    ];

    it('orders pins nearest to the anchor, not by raw source order', () => {
      const pins = selectSearchPins([...manhattanBagels, ...westburyBagels], westbury);

      expect(pins.slice(0, 3).map((p) => p.name)).toEqual([
        'Westbury Bagels',
        'Carle Place Bagels',
        'Hicksville Bagels',
      ]);
    });

    it('keeps the source order when there is no anchor', () => {
      const all = [...manhattanBagels, ...westburyBagels];
      expect(selectSearchPins(all, null)).toBe(all);
    });

    it('frames nearby results for a nearby-intent query', () => {
      expect(shouldFrameResults(westburyBagels, westbury, false)).toBe(true);
    });

    it('does not fly the map to a distant cluster for a nearby-intent query', () => {
      expect(shouldFrameResults(manhattanBagels, westbury, false)).toBe(false);
    });

    it('still frames a distant match for a place/brand/address search', () => {
      expect(shouldFrameResults(manhattanBagels, westbury, true)).toBe(true);
    });

    it('never frames an empty pin set', () => {
      expect(shouldFrameResults([], westbury, true)).toBe(false);
    });

    it('treats bare category phrases as nearby intent', () => {
      expect(isGenericNearbyQuery('bagels')).toBe(true);
      expect(isGenericNearbyQuery('coffee near me')).toBe(true);
      expect(isGenericNearbyQuery('pizza open now')).toBe(true);
    });

    it('treats proper-name tokens as a place lookup', () => {
      expect(isGenericNearbyQuery('h&h bagels')).toBe(false);
      expect(isGenericNearbyQuery('pizza palace')).toBe(false);
      expect(isGenericNearbyQuery('starbucks')).toBe(false);
    });
  });

  describe('proximity ordering of merged results', () => {
    const unionSquare = { lat: 40.7359, lng: -73.9911 };

    function result(id: number, text: string, lat: number, lng: number): GeocodingResult {
      return {
        entry: {
          id,
          text,
          type: 'place',
          housenumber: null,
          street: null,
          city: null,
          state: null,
          postcode: null,
          country: null,
          lat,
          lng,
        },
        rank: 0,
      };
    }

    const nycTatte = result(1, 'Tatte', 40.7355, -73.9945); // ~0.3 km
    const bostonTatte = result(2, 'Tatte', 42.3532, -71.0573); // ~300 km
    const arlingtonTatte = result(3, 'Tatte', 42.4154, -71.1565); // ~305 km

    it('keeps local matches above a distant cluster', () => {
      const ordered = preferNearbyResults([bostonTatte, arlingtonTatte, nycTatte], unionSquare);

      expect(ordered.map((r) => r.entry.id)).toEqual([1]);
    });

    it('keeps distant results when nothing local matched', () => {
      const ordered = preferNearbyResults([bostonTatte, arlingtonTatte], unionSquare);

      expect(ordered.map((r) => r.entry.id)).toEqual([2, 3]);
    });

    it('preserves the source order inside each proximity bucket', () => {
      const nearA = result(4, 'Near A', 40.74, -73.99);
      const nearB = result(5, 'Near B', 40.73, -73.98);
      const outer = result(6, 'Outer', 40.7359, -73.36); // ~53 km, kept but not local
      const ordered = preferNearbyResults([outer, bostonTatte, nearA, nearB], unionSquare);

      expect(ordered.map((r) => r.entry.id)).toEqual([4, 5, 6]);
    });

    it('leaves the list untouched without an anchor', () => {
      const input = [bostonTatte, nycTatte];
      expect(preferNearbyResults(input, null)).toBe(input);
    });

    it('keeps an explicit address destination in another city', () => {
      const farAddress: GeocodingResult = {
        ...result(7, '350 5th Ave, Boston', 42.35, -71.06),
        entry: {
          ...result(7, '350 5th Ave, Boston', 42.35, -71.06).entry,
          type: 'address',
        },
      };
      const ordered = preferNearbyResults([nycTatte, farAddress], unionSquare);

      expect(ordered.map((r) => r.entry.id)).toEqual([1, 7]);
    });
  });
});
