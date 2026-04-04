import type { TransitMode } from '../../models/transit';

/**
 * Registry of publicly accessible OpenTripPlanner deployments.
 *
 * Each entry maps a geographic bounding box to an OTP endpoint.
 * The router auto-selects the correct endpoint for a given origin
 * coordinate. Entries are tried in order; first bbox match wins.
 *
 * Sources: https://docs.opentripplanner.org/en/v2.7.0/Deployments/
 */

// ── Types ───────────────────────────────────────────────────────────

export type OtpApiStyle = 'rest-v1' | 'gtfs-graphql-v2' | 'transmodel-v3' | 'mbta-v3';

export interface OtpEndpoint {
  /** Human-readable label (for logging / debug UI). */
  label: string;
  /** Bounding box: [minLat, minLon, maxLat, maxLon]. */
  bbox: [number, number, number, number];
  /** Full URL to the plan endpoint (REST) or GraphQL endpoint. */
  url: string;
  /** Which API style this endpoint speaks. */
  apiStyle: OtpApiStyle;
  /** Extra headers to include (e.g. client-name for Entur). */
  headers?: Record<string, string>;
  /**
   * Base URL for the stops index (OTP1 REST only).
   * Used for station autocomplete search.  Derived from `url` if omitted
   * by replacing `/plan` with `/index/stops`.
   */
  stopsIndexUrl?: string;
}

// ── Registry ────────────────────────────────────────────────────────

export const OTP_ENDPOINTS: OtpEndpoint[] = [
  // ─── United States ──────────────────────────────────────────────
  {
    label: 'MTA New York City & Long Island',
    // Covers NYC metro + Long Island + lower Hudson Valley
    bbox: [40.4, -74.3, 41.4, -72.0],
    url: 'https://otp-mta-prod.camsys-apps.com/otp/routers/default/plan',
    apiStyle: 'rest-v1',
  },
  {
    label: 'TriMet Portland, OR',
    bbox: [45.2, -123.2, 45.8, -122.2],
    url: 'https://maps.trimet.org/otp_mod/plan',
    apiStyle: 'rest-v1',
  },

  {
    label: 'MBTA Boston & Massachusetts',
    // Covers greater Boston + commuter rail extent
    bbox: [41.0, -72.0, 43.0, -70.0],
    url: 'https://api-v3.mbta.com',
    apiStyle: 'mbta-v3',
  },

  // ─── Europe ─────────────────────────────────────────────────────
  {
    label: 'Entur Norway (nationwide)',
    bbox: [57.5, 4.0, 71.5, 31.5],
    url: 'https://api.entur.io/journey-planner/v3/graphql',
    apiStyle: 'transmodel-v3',
    headers: { 'ET-Client-Name': 'polaris-maps' },
  },
];

// ── Lookup ──────────────────────────────────────────────────────────

/**
 * Find the best OTP endpoint for a coordinate pair.
 * Returns the first entry whose bbox contains the origin point,
 * or `null` if no match.
 */
export function findEndpointForCoords(lat: number, lon: number): OtpEndpoint | null {
  for (const ep of OTP_ENDPOINTS) {
    const [minLat, minLon, maxLat, maxLon] = ep.bbox;
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
      return ep;
    }
  }
  return null;
}

// ── Station search via OTP stops index ──────────────────────────────

/** Cached full stops list per endpoint label (fetched once). */
const stopsCache = new Map<string, Array<{ name: string; lat: number; lon: number; id: string }>>();
const stopsFetchInFlight = new Map<string, Promise<void>>();

/**
 * Derive the OTP1 REST stops-index URL from the plan URL.
 * e.g. `.../otp/routers/default/plan` → `.../otp/routers/default/index/stops`
 */
function stopsIndexUrlFor(ep: OtpEndpoint): string | null {
  if (ep.stopsIndexUrl) return ep.stopsIndexUrl;
  if (ep.apiStyle === 'rest-v1') {
    return ep.url.replace(/\/plan$/, '/index/stops');
  }
  return null;
}

/**
 * Ensure the full stops list for an endpoint is loaded into `stopsCache`.
 * Only fires one request per endpoint; subsequent calls await the same promise.
 */
async function ensureStopsLoaded(ep: OtpEndpoint): Promise<void> {
  if (stopsCache.has(ep.label)) return;

  let promise = stopsFetchInFlight.get(ep.label);
  if (promise) return promise;

  promise = (async () => {
    const url = stopsIndexUrlFor(ep);
    if (!url) return;

    const controller = new AbortController();
    // 6 MB payload — give mobile networks plenty of time
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: ep.headers ?? {},
      });
      if (!res.ok) return;
      const data = (await res.json()) as Array<{
        name?: string;
        lat?: number;
        lon?: number;
        id?: string;
      }>;
      // Only keep rail / subway / tram stations (not bus stops).
      // Known rail prefixes from MTA OTP: LI (LIRR), MTASBWY (subway),
      // MNR (Metro-North), NJT (NJ Transit rail), JFK, PATH, RI, HRL, EWR, SIF.
      // Also exclude entrance/platform sub-nodes (id contains "-entrance" or "-ent-").
      const RAIL_PREFIXES = /^(LI|MTASBWY|MNR|NJT|JFK|PATH|RI|HRL|EWR|SIF):/;
      const ENTRANCE_RE = /-entrance|-ent-/;
      const stops = data
        .filter(
          (s) =>
            s.name &&
            s.lat != null &&
            s.lon != null &&
            s.id &&
            RAIL_PREFIXES.test(s.id) &&
            !ENTRANCE_RE.test(s.id),
        )
        .map((s) => ({ name: s.name!, lat: s.lat!, lon: s.lon!, id: s.id! }));
      stopsCache.set(ep.label, stops);
    } catch {
      // silently ignore — search will fall back to Overpass
    } finally {
      clearTimeout(timer);
      stopsFetchInFlight.delete(ep.label);
    }
  })();

  stopsFetchInFlight.set(ep.label, promise);
  return promise;
}

/**
 * Pre-warm the OTP stops cache for a given location.
 * Call this eagerly (e.g. on map init) so that subsequent searches
 * can use the cached data instantly instead of waiting for the 6 MB fetch.
 */
export function preloadOtpStops(lat: number, lon: number): void {
  const ep = findEndpointForCoords(lat, lon);
  if (ep) ensureStopsLoaded(ep);
}

/**
 * Search for transit stations using the OTP stops index for the
 * nearest registry endpoint.  Returns an empty array if no endpoint
 * covers the coordinates or the index isn't available.
 *
 * Results are filtered by name substring match, sorted by prefix match
 * then distance from `nearLat/nearLon`, and limited to 15.
 */
export async function searchOtpStops(
  query: string,
  nearLat: number,
  nearLon: number,
): Promise<Array<{ name: string; lat: number; lon: number; id: string }>> {
  if (!query.trim()) return [];
  const ep = findEndpointForCoords(nearLat, nearLon);
  if (!ep) return [];

  // If the stops index is already cached, use it immediately.
  // If a fetch is in-flight (preload started), wait up to 8 s for it.
  // If neither, kick off a fetch and wait.
  if (!stopsCache.has(ep.label)) {
    const inFlight = stopsFetchInFlight.get(ep.label);
    const loadPromise = inFlight ?? ensureStopsLoaded(ep);
    await Promise.race([loadPromise, new Promise<void>((r) => setTimeout(r, 8_000))]);
  }

  const stops = stopsCache.get(ep.label);
  if (!stops) return [];

  const q = query.toLowerCase();
  const matches = stops.filter((s) => s.name.toLowerCase().includes(q));

  // Deduplicate by name + rough location (some stops have multiple platform nodes)
  const seen = new Set<string>();
  const deduped: typeof matches = [];
  for (const s of matches) {
    const key = `${s.name}:${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  // Sort: prefix match first, then by distance
  return deduped
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const da = (a.lat - nearLat) ** 2 + (a.lon - nearLon) ** 2;
      const db = (b.lat - nearLat) ** 2 + (b.lon - nearLon) ** 2;
      return da - db;
    })
    .slice(0, 15)
    .map(({ name, lat, lon, id }) => ({ name, lat, lon, id }));
}

/**
 * Fetch routes serving an OTP stop by its ID.
 * Uses the OTP1 REST `/index/stops/{id}/routes` endpoint.
 */
export async function fetchOtpRoutesAtStop(
  stopId: string,
  lat: number,
  lon: number,
): Promise<Array<{ ref?: string; name?: string; color?: string; mode: TransitMode }>> {
  const ep = findEndpointForCoords(lat, lon);
  if (!ep || ep.apiStyle !== 'rest-v1') return [];

  const baseUrl = ep.url.replace(/\/plan$/, '');
  const url = `${baseUrl}/index/stops/${encodeURIComponent(stopId)}/routes`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: ep.headers ?? {},
    });
    if (!res.ok) return [];
    const routes = (await res.json()) as Array<{
      shortName?: string;
      longName?: string;
      mode?: string;
      color?: string;
    }>;
    return routes.map((r) => ({
      ref: r.shortName,
      name: r.longName,
      color: r.color,
      mode: (r.mode ?? 'RAIL') as TransitMode,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
