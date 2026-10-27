jest.mock('../../src/native/mapkit', () => ({
  isMapKitAvailable: jest.fn(() => true),
  searchNearby: jest.fn(),
}));

import { isMapKitAvailable, searchNearby } from '../../src/native/mapkit';
import { searchMapKitPlaces } from '../../src/services/search/mapKitPlaceSource';

const cafe = {
  name: 'Tatte Bakery & Cafe',
  latitude: 40.7405,
  longitude: -73.9856,
  pointOfInterestCategory: 'MKPOICategoryCafe',
  thoroughfare: 'Park Ave S',
  subThoroughfare: '315',
  locality: 'New York',
  administrativeArea: 'NY',
  country: 'United States',
  phoneNumber: '+1 212-555-0100',
  url: 'https://tattebakery.com',
};

describe('mapKitPlaceSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isMapKitAvailable as jest.Mock).mockReturnValue(true);
    (searchNearby as jest.Mock).mockResolvedValue([]);
  });

  it('adapts an Apple POI to the shared OsmPoi shape', async () => {
    (searchNearby as jest.Mock).mockResolvedValue([cafe]);

    const [poi] = await searchMapKitPlaces('tatte', 40.745, -73.992, 20);

    expect(poi).toMatchObject({
      name: 'Tatte Bakery & Cafe',
      type: 'amenity',
      subtype: 'cafe',
      lat: 40.7405,
      lng: -73.9856,
    });
    expect(poi.id).toBeLessThan(0);
    expect(poi.tags).toMatchObject({
      'addr:city': 'New York',
      'addr:state': 'NY',
      'addr:housenumber': '315',
      'addr:street': 'Park Ave S',
      'polaris:source': 'mapkit',
    });
    // The native call is scoped to the search anchor.
    expect(searchNearby).toHaveBeenCalledWith('tatte', 40.745, -73.992, 15_000);
  });

  it('falls back to a neutral shape for an unknown category', async () => {
    (searchNearby as jest.Mock).mockResolvedValue([
      { name: 'Somewhere', latitude: 40.7, longitude: -73.9 },
    ]);

    const [poi] = await searchMapKitPlaces('somewhere', 40.745, -73.992, 20);

    expect(poi).toMatchObject({ type: 'amenity', subtype: 'place' });
  });

  it('skips results without a name or coordinates', async () => {
    (searchNearby as jest.Mock).mockResolvedValue([
      { latitude: 40.7, longitude: -73.9 },
      { name: 'No coords', latitude: Number.NaN, longitude: -73.9 },
      cafe,
    ]);

    const pois = await searchMapKitPlaces('tatte', 40.745, -73.992, 20);

    expect(pois.map((p) => p.name)).toEqual(['Tatte Bakery & Cafe']);
  });

  it('honours the result limit', async () => {
    (searchNearby as jest.Mock).mockResolvedValue([
      { ...cafe, name: 'One' },
      { ...cafe, name: 'Two' },
      { ...cafe, name: 'Three' },
    ]);

    const pois = await searchMapKitPlaces('tatte', 40.745, -73.992, 2);

    expect(pois.map((p) => p.name)).toEqual(['One', 'Two']);
  });

  it('returns an empty list when MapKit is unavailable', async () => {
    (isMapKitAvailable as jest.Mock).mockReturnValue(false);

    expect(await searchMapKitPlaces('tatte', 40.745, -73.992, 20)).toEqual([]);
    expect(searchNearby).not.toHaveBeenCalled();
  });

  it('rejects on a native failure so it stays retryable, not cached as empty', async () => {
    (searchNearby as jest.Mock).mockRejectedValue(new Error('MapKit offline'));

    await expect(searchMapKitPlaces('tatte', 40.745, -73.992, 20)).rejects.toThrow(
      'MapKit offline',
    );
  });

  it('does not start a request for an already-aborted search', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      await searchMapKitPlaces('tatte', 40.745, -73.992, 20, { signal: controller.signal }),
    ).toEqual([]);
    expect(searchNearby).not.toHaveBeenCalled();
  });
});
