import {
  consumeMapLongPress,
  consumeMapPress,
  extractMapCoordinates,
  extractScreenPoint,
} from '../../src/components/map/mapPressHandlers';

describe('mapPressHandlers', () => {
  it('extracts lat/lng from map events', () => {
    expect(
      extractMapCoordinates({
        geometry: { coordinates: [-122.406417, 37.785834] },
      }),
    ).toEqual({ lat: 37.785834, lng: -122.406417 });
  });

  it('extracts the screen point used to hit-test basemap layers', () => {
    expect(
      extractScreenPoint({
        geometry: { coordinates: [-122.406417, 37.785834] },
        properties: { screenPointX: 120, screenPointY: 240 },
      }),
    ).toEqual([120, 240]);
  });

  it('returns null for the screen point when the platform omits it', () => {
    expect(
      extractScreenPoint({
        geometry: { coordinates: [-122.406417, 37.785834] },
      }),
    ).toBeNull();
    expect(
      extractScreenPoint({
        geometry: { coordinates: [-122.406417, 37.785834] },
        properties: { screenPointX: 120 },
      }),
    ).toBeNull();
  });

  it('suppresses the first plain press after a long press', () => {
    const suppressNextPressRef = { current: false };

    expect(
      consumeMapLongPress(
        { geometry: { coordinates: [-73.985664, 40.748433] } },
        suppressNextPressRef,
      ),
    ).toEqual({ lat: 40.748433, lng: -73.985664 });
    expect(suppressNextPressRef.current).toBe(true);

    expect(
      consumeMapPress(
        { geometry: { coordinates: [-122.406417, 37.785834] } },
        suppressNextPressRef,
      ),
    ).toBeNull();
    expect(suppressNextPressRef.current).toBe(false);

    expect(
      consumeMapPress(
        { geometry: { coordinates: [-122.406417, 37.785834] } },
        suppressNextPressRef,
      ),
    ).toEqual({ lat: 37.785834, lng: -122.406417 });
  });
});
