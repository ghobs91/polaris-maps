import { tomtomApiKey } from '../../constants/config';
import { decodePolyline } from '../../utils/polyline';
import { TtlCache } from '../../utils/ttlCache';
import {
  canCallTomTom,
  isTomTomConfigured,
  noteTomTomNetworkError,
  noteTomTomRequest,
  noteTomTomResponse,
} from './tomtomAccess';

const TOMTOM_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
/** Route ETAs are stable for a few minutes and are re-requested every 60 s. */
const ROUTE_ETA_TTL_MS = 5 * 60 * 1000;
const ROUTE_ETA_CACHE_ENTRIES = 32;

interface RouteEta {
  travelTimeSeconds: number;
  trafficDelaySeconds: number;
}

const routeEtaCache = new TtlCache<string, RouteEta>(ROUTE_ETA_TTL_MS, ROUTE_ETA_CACHE_ENTRIES);

function routeEtaCacheKey(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): string {
  return `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}-${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;
}

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
): Promise<RouteEta | null> {
  if (!isTomTomConfigured()) return null;

  const cacheKey = routeEtaCacheKey(origin, destination);
  const cached = routeEtaCache.get(cacheKey);
  if (cached) return cached;

  if (!canCallTomTom()) return null;
  noteTomTomRequest();

  const coords = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
  const url = `${TOMTOM_ROUTE_URL}/${coords}/json?key=${encodeURIComponent(tomtomApiKey)}&traffic=true&travelMode=car`;

  try {
    const res = await fetch(url);
    noteTomTomResponse(res.status);
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary) return null;

    const result: RouteEta = {
      travelTimeSeconds: summary.travelTimeInSeconds ?? 0,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
    };
    routeEtaCache.set(cacheKey, result);
    return result;
  } catch {
    noteTomTomNetworkError();
    return null;
  }
}

/** Test-only: clear the ETA cache. */
export function __resetTomTomRouteEtaCacheForTests(): void {
  routeEtaCache.clear();
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
