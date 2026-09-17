import {
  destinationToGeocodingResult,
  geocodingResultToSearchResult,
  isSameDestination,
} from '../../src/components/map/floatingSearchPanelHelpers';
import type { GeocodingResult } from '../../src/services/geocoding/geocodingService';

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
});
