import {
  applySearchView,
  destinationToGeocodingResult,
  geocodingResultToSearchResult,
  isGenericNearbyQuery,
  isSameDestination,
  preferNearbyResults,
  selectSearchPins,
  shouldFrameResults,
} from '../../src/components/map/floatingSearchPanelHelpers';
import { resolveSearchCamera } from '../../src/utils/searchCamera';
import type { UnifiedSearchResult } from '../../src/services/search/unifiedSearch';
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

  describe('search camera anchor', () => {
    // The user located on Westbury (so mapStore.viewport still says Westbury)
    // and then panned to Manhattan without any programmatic camera move.
    const staleProgrammatic = { lat: 40.7557, lng: -73.5876, zoom: 15 };
    const pannedManhattan = { minLat: 40.72, maxLat: 40.78, minLng: -74.02, maxLng: -73.96 };

    it('anchors on the panned viewport, not the stale programmatic centre', () => {
      expect(resolveSearchCamera(staleProgrammatic, pannedManhattan, 13)).toEqual({
        lat: 40.75,
        lng: -73.99,
        zoom: 13,
      });
    });

    it('uses the live zoom over the stale one', () => {
      expect(
        resolveSearchCamera({ ...staleProgrammatic, zoom: 15 }, pannedManhattan, 11).zoom,
      ).toBe(11);
    });

    it('falls back to the programmatic camera before the first region change', () => {
      expect(resolveSearchCamera(staleProgrammatic, null, 0)).toEqual(staleProgrammatic);
    });

    it('keeps the fallback zoom when the live zoom is not known yet', () => {
      expect(resolveSearchCamera(staleProgrammatic, pannedManhattan, 0).zoom).toBe(15);
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

    it('never drops a distant city the user named', () => {
      // "paris" from New York: a local café called Paris must not delete Paris.
      const localCafe: GeocodingResult = {
        ...result(10, 'Paris Cafe', 40.74, -73.99),
        poi: {
          id: 10,
          name: 'Paris Cafe',
          lat: 40.74,
          lng: -73.99,
          type: 'amenity',
          subtype: 'cafe',
          tags: {},
        },
      };
      const paris: GeocodingResult = {
        ...result(11, 'Paris', 48.8566, 2.3522),
        poi: {
          id: 11,
          name: 'Paris',
          lat: 48.8566,
          lng: 2.3522,
          type: 'place',
          subtype: 'city',
          tags: { place: 'city' },
        },
      };

      const ordered = preferNearbyResults([paris, localCafe], unionSquare);

      expect(ordered.map((r) => r.entry.id)).toContain(11);
    });

    it('drops distant results when nothing local matched', () => {
      const ordered = preferNearbyResults([bostonTatte, arlingtonTatte], unionSquare);

      expect(ordered).toEqual([]);
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

  describe('search view (filters + sort)', () => {
    function row(id: number, text: string, lat: number, lng: number): GeocodingResult {
      const base = destinationToGeocodingResult({ lat, lng, name: text });
      return { ...base, entry: { ...base.entry, id } };
    }

    const closedButNear = row(1, 'Closed Cafe', 40.736, -73.991);
    const openButFar = row(2, 'Open Cafe', 40.75, -73.99);
    const origin = { lat: 40.7359, lng: -73.9911 };

    const ranked = new Map<string, UnifiedSearchResult>([
      [
        String(closedButNear.entry.id),
        {
          name: 'Closed Cafe',
          subtitle: '',
          lat: 40.736,
          lng: -73.991,
          type: 'poi',
          score: 90,
          distanceKm: 0.02,
          openNow: false,
        },
      ],
      [
        String(openButFar.entry.id),
        {
          name: 'Open Cafe',
          subtitle: '',
          lat: 40.75,
          lng: -73.99,
          type: 'poi',
          score: 70,
          distanceKm: 1.6,
          openNow: true,
        },
      ],
    ]);

    it('drops closed places when the open-now filter is on', () => {
      const visible = applySearchView(
        [closedButNear, openButFar],
        ranked,
        origin,
        { openNow: true },
        'relevance',
      );

      expect(visible.map((r) => r.entry.id)).toEqual([2]);
    });

    it('keeps rows with unknown data (no ranked payload passes through)', () => {
      const station = row(3, 'Grand Central', 40.7527, -73.9772);
      const visible = applySearchView(
        [closedButNear, station],
        ranked,
        origin,
        { openNow: true },
        'relevance',
      );

      expect(visible.map((r) => r.entry.id)).toEqual([3]);
    });

    it('sorts by distance using a measured distance for unranked rows', () => {
      const station = row(3, 'Grand Central', 40.7527, -73.9772);
      const visible = applySearchView([closedButNear, station], ranked, origin, {}, 'distance');

      expect(visible[0]!.entry.id).toBe(1);
      expect(visible[1]!.entry.id).toBe(3);
    });

    it('honours the max-distance filter', () => {
      const visible = applySearchView(
        [closedButNear, openButFar],
        ranked,
        origin,
        { maxDistanceKm: 1 },
        'relevance',
      );

      expect(visible.map((r) => r.entry.id)).toEqual([1]);
    });
  });
});
