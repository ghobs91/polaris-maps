export interface MapPressEvent {
  geometry: {
    coordinates: [number, number];
  };
  properties?: {
    screenPointX?: number;
    screenPointY?: number;
  };
}

export interface SuppressNextPressRef {
  current: boolean;
}

export function extractMapCoordinates(event: MapPressEvent): { lat: number; lng: number } {
  const [lng, lat] = event.geometry.coordinates;
  return { lat, lng };
}

/**
 * Screen-space point of a tap (MapLibre reports it in the event properties on
 * both iOS and Android). Used to hit-test rendered basemap layers, e.g. the
 * `housenumber` labels. Returns null when the platform omitted it.
 */
export function extractScreenPoint(
  event: MapPressEvent,
): [screenPointX: number, screenPointY: number] | null {
  const x = event.properties?.screenPointX;
  const y = event.properties?.screenPointY;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return [x, y];
}

export function consumeMapPress(
  event: MapPressEvent,
  suppressNextPressRef: SuppressNextPressRef,
): { lat: number; lng: number } | null {
  if (suppressNextPressRef.current) {
    suppressNextPressRef.current = false;
    return null;
  }

  return extractMapCoordinates(event);
}

export function consumeMapLongPress(
  event: MapPressEvent,
  suppressNextPressRef: SuppressNextPressRef,
): { lat: number; lng: number } {
  suppressNextPressRef.current = true;
  return extractMapCoordinates(event);
}
