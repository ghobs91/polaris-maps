import {
  resolvePlaceAtAddress,
  ADDRESS_TAP_RADIUS_KM,
} from '../../src/services/poi/addressPlaceResolver';

const mockGetNearbyPlaces = jest.fn();
const mockPlaceToOsmPoi = jest.fn();
const mockResolveMapSelectionPoi = jest.fn();

jest.mock('../../src/services/poi/poiService', () => ({
  getNearbyPlaces: (...args: unknown[]) => mockGetNearbyPlaces(...args),
}));

jest.mock('../../src/utils/placeToOsmPoi', () => ({
  placeToOsmPoi: (...args: unknown[]) => mockPlaceToOsmPoi(...args),
}));

jest.mock('../../src/services/poi/mapSelectionPoi', () => ({
  resolveMapSelectionPoi: (...args: unknown[]) => mockResolveMapSelectionPoi(...args),
}));

describe('addressPlaceResolver', () => {
  beforeEach(() => {
    mockGetNearbyPlaces.mockReset();
    mockPlaceToOsmPoi.mockReset();
    mockResolveMapSelectionPoi.mockReset();
  });

  it('returns the nearest known place when the local index has one in range', async () => {
    const place = { uuid: 'p1', name: 'Corner Cafe', lat: 40.1, lng: -73.2 };
    const expectedPoi = { id: -1, name: 'Corner Cafe' };
    mockGetNearbyPlaces.mockResolvedValueOnce([place]);
    mockPlaceToOsmPoi.mockReturnValueOnce(expectedPoi);

    const result = await resolvePlaceAtAddress(40.1, -73.2);

    expect(mockGetNearbyPlaces).toHaveBeenCalledWith(40.1, -73.2, ADDRESS_TAP_RADIUS_KM);
    expect(mockPlaceToOsmPoi).toHaveBeenCalledWith(place);
    expect(result).toBe(expectedPoi);
    expect(mockResolveMapSelectionPoi).not.toHaveBeenCalled();
  });

  it('falls back to a reverse-geocoded address when nothing is known', async () => {
    const fallbackPoi = { id: -99, name: '123 Main St' };
    mockGetNearbyPlaces.mockResolvedValueOnce([]);
    mockResolveMapSelectionPoi.mockResolvedValueOnce(fallbackPoi);

    const result = await resolvePlaceAtAddress(37.5, -122.3);

    expect(mockResolveMapSelectionPoi).toHaveBeenCalledWith(37.5, -122.3);
    expect(result).toBe(fallbackPoi);
  });

  it('falls back to a reverse-geocoded address when the index query throws', async () => {
    const fallbackPoi = { id: -100, name: 'Dropped Pin' };
    mockGetNearbyPlaces.mockRejectedValueOnce(new Error('db unavailable'));
    mockResolveMapSelectionPoi.mockResolvedValueOnce(fallbackPoi);

    const result = await resolvePlaceAtAddress(48.85, 2.35);

    expect(mockResolveMapSelectionPoi).toHaveBeenCalledWith(48.85, 2.35);
    expect(result).toBe(fallbackPoi);
  });
});
