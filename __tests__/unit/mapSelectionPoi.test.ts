import {
  MAP_SELECTION_KIND_TAG,
  createMapSelectionPoi,
  isMapSelectionPoi,
  resolveMapSelectionPoi,
} from '../../src/services/poi/mapSelectionPoi';

const mockReverseGeocode = jest.fn();

jest.mock('../../src/services/geocoding/geocodingService', () => ({
  reverseGeocode: (...args: unknown[]) => mockReverseGeocode(...args),
}));

describe('mapSelectionPoi', () => {
  beforeEach(() => {
    mockReverseGeocode.mockReset();
  });

  it('creates a synthetic address POI from a reverse-geocoded entry', () => {
    const poi = createMapSelectionPoi(40.7128, -74.006, {
      id: 7,
      text: '123 Main St, New York, NY 10001',
      type: 'address',
      housenumber: '123',
      street: 'Main St',
      city: 'New York',
      state: 'NY',
      postcode: '10001',
      country: 'USA',
      lat: 40.7128,
      lng: -74.006,
    });

    expect(poi.id).toBeLessThan(0);
    expect(poi.name).toBe('123 Main St');
    expect(poi.type).toBe('place');
    expect(poi.subtype).toBe('address');
    expect(poi.tags[MAP_SELECTION_KIND_TAG]).toBe('map_long_press');
    expect(poi.tags['addr:street']).toBe('Main St');
    expect(poi.tags['addr:city']).toBe('New York');
    expect(poi.tags['addr:full']).toBe('123 Main St, New York, NY 10001');
    expect(isMapSelectionPoi(poi)).toBe(true);
  });

  it('falls back to a dropped pin when reverse geocoding has no match', async () => {
    mockReverseGeocode.mockResolvedValueOnce(null);

    const poi = await resolveMapSelectionPoi(37.785834, -122.406417);

    expect(mockReverseGeocode).toHaveBeenCalledWith(37.785834, -122.406417);
    expect(poi.name).toBe('Dropped Pin');
    expect(poi.tags['addr:full']).toBe('37.78583, -122.40642');
    expect(isMapSelectionPoi(poi)).toBe(true);
  });
});
