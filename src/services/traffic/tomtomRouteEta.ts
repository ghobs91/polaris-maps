import { tomtomApiKey, tomtomProxyUrl } from '../../constants/config';
import { decodePolyline } from '../../utils/polyline';

const TOMTOM_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';

/**
 * Fetch a traffic-adjusted ETA from TomTom Calculate Route API.
 * Takes origin/destination (from the Valhalla route endpoints) and returns
 * travel time in seconds accounting for current traffic conditions.
 *
 * Returns null if the API key is missing or the request fails.
 */
export async function fetchTomTomRouteEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<{ travelTimeSeconds: number; trafficDelaySeconds: number } | null> {
  if (!tomtomProxyUrl && !tomtomApiKey) return null;

  const coords = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
  // When a proxy URL is configured, the server appends the API key — no key in the bundle.
  const routeBase = tomtomProxyUrl ? `${tomtomProxyUrl}/route` : TOMTOM_ROUTE_URL;
  const keyParam = tomtomProxyUrl ? '' : `&key=${encodeURIComponent(tomtomApiKey)}`;
  const url = `${routeBase}/${coords}/json?traffic=true&travelMode=car${keyParam}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary) return null;

    return {
      travelTimeSeconds: summary.travelTimeInSeconds ?? 0,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch traffic-adjusted ETA using the route geometry's start/end points.
 * Convenience wrapper that extracts endpoints from an encoded polyline.
 */
export async function fetchRouteTrafficEta(
  geometry: string,
): Promise<{ travelTimeSeconds: number; trafficDelaySeconds: number } | null> {
  const coords = decodePolyline(geometry);
  if (coords.length < 2) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];

  return fetchTomTomRouteEta({ lat: first[1], lng: first[0] }, { lat: last[1], lng: last[0] });
}
