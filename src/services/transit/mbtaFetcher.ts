/**
 * MBTA V3 API integration for the Boston metro area.
 *
 * Provides two capabilities:
 *   1. Route lines (shapes + stops) for the transit map layer
 *   2. Real schedule + prediction departures for the stop card
 *
 * Uses the MBTA V3 JSON:API (https://api-v3.mbta.com/docs/swagger/)
 * which is separate from the OTP1 REST pattern used by MTA NYC.
 *
 * Requires EXPO_PUBLIC_MBTA_API_KEY in .env (free, 1000 req/min).
 */

import type { TransitMode, TransitRouteLine, TransitRouteLineStop } from '../../models/transit';
import { decodePolyline } from '../../utils/polyline';
import type { StopDepartureInfo, Departure } from './transitDepartureFetcher';

const MBTA_BASE = 'https://api-v3.mbta.com';
const FETCH_TIMEOUT_MS = 30_000;

function mbtaApiKey(): string {
  return (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_MBTA_API_KEY) || '';
}

function mbtaUrl(path: string, params: Record<string, string> = {}): string {
  const key = mbtaApiKey();
  const qs = new URLSearchParams(params);
  if (key) qs.set('api_key', key);
  return `${MBTA_BASE}${path}?${qs.toString()}`;
}

// ── MBTA route type → TransitMode ───────────────────────────────────

function mbtaTypeToMode(type: number): TransitMode {
  switch (type) {
    case 0:
      return 'TRAM'; // Light rail (Green Line, Mattapan)
    case 1:
      return 'SUBWAY'; // Heavy rail (Red, Orange, Blue)
    case 2:
      return 'RAIL'; // Commuter rail
    case 4:
      return 'FERRY';
    default:
      return 'RAIL';
  }
}

// ── JSON:API helpers ────────────────────────────────────────────────

interface JsonApiResource {
  type: string;
  id: string;
  attributes: Record<string, any>;
  relationships?: Record<string, { data: { type: string; id: string } | null }>;
}

interface JsonApiResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

async function mbtaFetch(
  path: string,
  params: Record<string, string> = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<JsonApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(mbtaUrl(path, params), {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MBTA ${res.status}`);
    return (await res.json()) as JsonApiResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ── Route lines cache ───────────────────────────────────────────────

let cachedLines: TransitRouteLine[] | null = null;
let fetchInFlight: Promise<TransitRouteLine[]> | null = null;

/**
 * Fetch all MBTA rail / subway / tram route lines with geometry + stops.
 *
 * Strategy:
 *   1. GET /routes?filter[type]=0,1,2 — 21 routes (~0.1s)
 *   2. For each route (parallel, 6 concurrent):
 *      a. GET /shapes?filter[route]={id} — pick canonical or longest polyline
 *      b. GET /stops?filter[route]={id} — stop names + coords
 *   3. Decode polylines, build TransitRouteLine[]
 *
 * Total time: ~2s on a good connection.  Cached permanently.
 */
export async function fetchMbtaLines(): Promise<TransitRouteLine[]> {
  if (cachedLines) return cachedLines;
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async (): Promise<TransitRouteLine[]> => {
    try {
      // 1. Get all rail routes
      const routesData = await mbtaFetch('/routes', {
        'filter[type]': '0,1,2',
      });

      const routes = routesData.data;
      const lines: TransitRouteLine[] = [];

      // 2. Fetch shapes + stops per route (batched, 6 concurrent)
      const batches: (typeof routes)[] = [];
      for (let i = 0; i < routes.length; i += 6) {
        batches.push(routes.slice(i, i + 6));
      }

      for (const batch of batches) {
        const results = await Promise.all(
          batch.map(async (route): Promise<TransitRouteLine | null> => {
            try {
              const [shapesData, stopsData] = await Promise.all([
                mbtaFetch('/shapes', { 'filter[route]': route.id }),
                mbtaFetch('/stops', { 'filter[route]': route.id }),
              ]);

              // Pick canonical shape (longest), preferring those starting with "canonical-"
              const shapes = shapesData.data;
              if (shapes.length === 0) return null;

              // Prefer canonical shapes, then pick the one with the longest polyline
              const canonical = shapes.filter((s) => s.id.startsWith('canonical'));
              const candidates = canonical.length > 0 ? canonical : shapes;
              const best = candidates.reduce((a, b) =>
                (a.attributes.polyline?.length ?? 0) >= (b.attributes.polyline?.length ?? 0)
                  ? a
                  : b,
              );

              const polyline = best.attributes.polyline;
              if (!polyline) return null;

              // MBTA uses Google precision-5 polylines
              const coords = decodePolyline(polyline, 5);
              if (coords.length < 2) return null;

              // Build stops
              const stops: TransitRouteLineStop[] = stopsData.data
                .filter(
                  (s: JsonApiResource) =>
                    s.attributes.name &&
                    s.attributes.latitude != null &&
                    s.attributes.longitude != null,
                )
                // Only keep parent stations or stops without parents (avoid platform dupes)
                .filter((s: JsonApiResource) => {
                  const locType = s.attributes.location_type;
                  // location_type 1 = station (parent), 0 = platform/stop
                  // Keep stations. For stops, keep only if no parent.
                  if (locType === 1) return true;
                  const parent = s.relationships?.parent_station?.data;
                  return !parent;
                })
                .map((s: JsonApiResource) => ({
                  name: s.attributes.name,
                  lat: s.attributes.latitude,
                  lon: s.attributes.longitude,
                  stopId: `mbta:${s.id}`,
                }));

              // Deduplicate stops by name (multiple platforms)
              const seenStops = new Set<string>();
              const dedupedStops = stops.filter((s: TransitRouteLineStop) => {
                if (seenStops.has(s.name)) return false;
                seenStops.add(s.name);
                return true;
              });

              const attrs = route.attributes;
              let color = (attrs.color ?? '').replace('#', '');
              if (!/^[0-9A-Fa-f]{6}$/.test(color)) color = '';

              const mode = mbtaTypeToMode(attrs.type);
              const name = attrs.long_name || attrs.short_name || route.id;

              return {
                id: `mbta:${route.id}`,
                ref: attrs.short_name || undefined,
                name,
                operator: 'MBTA',
                color: color || undefined,
                mode,
                geometry: [coords],
                stops: dedupedStops,
              };
            } catch {
              return null;
            }
          }),
        );

        for (const line of results) {
          if (line) lines.push(line);
        }
      }

      cachedLines = lines;
      return lines;
    } catch {
      return [];
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

/** Check if MBTA lines are already cached. */
export function hasCachedMbtaLines(): boolean {
  return cachedLines !== null && cachedLines.length > 0;
}

/** Get cached MBTA lines without fetching. */
export function getCachedMbtaLines(): TransitRouteLine[] {
  return cachedLines ?? [];
}

// ── Departures ──────────────────────────────────────────────────────

/** Stop ID cache: lat/lon key → MBTA parent station ID */
const stopIdCache = new Map<string, string | null>();

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Find the MBTA parent station ID nearest to the given coordinates.
 * Uses the MBTA stops API radius filter.
 */
async function findMbtaStopId(lat: number, lon: number): Promise<string | null> {
  const key = coordKey(lat, lon);
  if (stopIdCache.has(key)) return stopIdCache.get(key)!;

  try {
    const data = await mbtaFetch('/stops', {
      'filter[latitude]': lat.toFixed(6),
      'filter[longitude]': lon.toFixed(6),
      'filter[radius]': '0.02',
      'filter[route_type]': '0,1,2',
    });

    // Find the closest parent station
    const parentIds = new Set<string>();
    let closestId: string | null = null;
    let closestDist = Infinity;

    for (const stop of data.data) {
      const sLat = stop.attributes.latitude;
      const sLon = stop.attributes.longitude;
      const dist = Math.hypot(sLat - lat, sLon - lon);

      // Use parent station ID if available
      const parentData = stop.relationships?.parent_station?.data;
      const stationId = parentData?.id ?? stop.id;

      if (!parentIds.has(stationId) && dist < closestDist) {
        closestDist = dist;
        closestId = stationId;
      }
      parentIds.add(stationId);
    }

    stopIdCache.set(key, closestId);
    return closestId;
  } catch {
    stopIdCache.set(key, null);
    return null;
  }
}

/**
 * Fetch real schedule + prediction departures from the MBTA V3 API.
 *
 * Returns null if the stop is not found or the API is unavailable,
 * signalling the caller to fall back to headway estimation.
 */
export async function fetchMbtaDepartures(
  stopName: string,
  lat: number,
  lon: number,
): Promise<StopDepartureInfo | null> {
  const stationId = await findMbtaStopId(lat, lon);
  if (!stationId) return null;

  // Fetch schedules and predictions in parallel
  const [schedData, predData] = await Promise.all([
    mbtaFetch('/schedules', {
      'filter[stop]': stationId,
      sort: 'departure_time',
      include: 'route,trip',
    }).catch(() => null),
    mbtaFetch('/predictions', {
      'filter[stop]': stationId,
      sort: 'departure_time',
      include: 'route,trip',
    }).catch(() => null),
  ]);

  const included = new Map<string, JsonApiResource>();
  for (const r of schedData?.included ?? []) {
    included.set(`${r.type}:${r.id}`, r);
  }
  for (const r of predData?.included ?? []) {
    included.set(`${r.type}:${r.id}`, r);
  }

  const now = Date.now();

  // Build predictions map: trip_id → prediction attrs
  const predByTrip = new Map<string, Record<string, any>>();
  for (const p of predData?.data ?? []) {
    const tripId = p.relationships?.trip?.data?.id;
    if (tripId) predByTrip.set(tripId, p.attributes);
  }

  // Process schedules into departures
  const departures: Departure[] = [];
  const routeSet = new Map<string, { name: string; color?: string; mode: TransitMode }>();

  for (const sched of schedData?.data ?? []) {
    const attrs = sched.attributes;
    const depTime = attrs.departure_time;
    if (!depTime) continue;

    const depMs = new Date(depTime).getTime();
    // Only show departures in the future (up to 4 hours ahead)
    if (depMs < now || depMs > now + 4 * 3600_000) continue;

    const routeId = sched.relationships?.route?.data?.id;
    const tripId = sched.relationships?.trip?.data?.id;
    const route = routeId ? included.get(`route:${routeId}`) : undefined;
    const trip = tripId ? included.get(`trip:${tripId}`) : undefined;

    const routeAttrs = route?.attributes ?? {};
    const tripAttrs = trip?.attributes ?? {};

    const headsign = tripAttrs.headsign ?? '';
    const routeName = routeAttrs.long_name ?? routeAttrs.short_name ?? routeId ?? '';
    let color = (routeAttrs.color ?? '').replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(color)) color = '';

    const mode = mbtaTypeToMode(routeAttrs.type ?? 2);

    // Check for real-time prediction override
    const pred = tripId ? predByTrip.get(tripId) : undefined;
    const isRealtime = !!pred?.departure_time;
    const realtimeTime = pred?.departure_time ?? undefined;
    const effectiveMs = isRealtime ? new Date(realtimeTime!).getTime() : depMs;

    departures.push({
      routeName,
      routeLongName: routeAttrs.long_name,
      headsign,
      color: color || undefined,
      mode,
      scheduledTime: depTime,
      realtimeTime,
      isRealtime,
      minutesAway: Math.max(0, Math.round((effectiveMs - now) / 60_000)),
    });

    // Track unique routes for badges
    if (routeId && !routeSet.has(routeId)) {
      routeSet.set(routeId, {
        name: routeName,
        color: color || undefined,
        mode,
      });
    }
  }

  // Sort by effective departure time
  departures.sort((a, b) => a.minutesAway - b.minutesAway);

  return {
    stopName,
    routes: [...routeSet.values()],
    alerts: [],
    departures: departures.slice(0, 20),
  };
}

// ── Bounding box check ──────────────────────────────────────────────

/** MBTA coverage: greater Boston + commuter rail extent. */
const MBTA_BBOX: [number, number, number, number] = [41.0, -72.0, 43.0, -70.0];

/** Check if coordinates fall within the MBTA service area. */
export function isInMbtaArea(lat: number, lon: number): boolean {
  return lat >= MBTA_BBOX[0] && lat <= MBTA_BBOX[2] && lon >= MBTA_BBOX[1] && lon <= MBTA_BBOX[3];
}
