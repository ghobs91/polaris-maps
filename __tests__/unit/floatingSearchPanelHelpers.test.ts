import {
  destinationToGeocodingResult,
  isSameDestination,
} from '../../src/components/map/floatingSearchPanelHelpers';

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
