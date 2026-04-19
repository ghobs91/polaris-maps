export interface MapPressEvent {
  geometry: {
    coordinates: [number, number];
  };
}

export interface SuppressNextPressRef {
  current: boolean;
}

export function extractMapCoordinates(event: MapPressEvent): { lat: number; lng: number } {
  const [lng, lat] = event.geometry.coordinates;
  return { lat, lng };
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
