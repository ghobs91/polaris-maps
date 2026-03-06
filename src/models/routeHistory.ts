export type RouteMode = 'driving' | 'walking' | 'cycling';

export interface RouteHistory {
  id: string;
  originLat: number;
  originLng: number;
  originName: string | null;
  destinationLat: number;
  destinationLng: number;
  destinationName: string | null;
  mode: RouteMode;
  distanceMeters: number;
  durationSeconds: number;
  routeGeometry: string; // encoded polyline
  createdAt: number;
}
