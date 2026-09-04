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

export type OtpApiStyle =
  | 'rest-v1'
  | 'gtfs-graphql-v2'
  | 'transmodel-v3'
  | 'mbta-v3'
  | 'wmata-gtfs-v1'
  | 'bart-gtfs-v1'
  | 'tfl-v1'
  | 'cta-gtfs-v1'
  | 'septa-gtfs-v1'
  | 'lametro-gtfs-v1'
  | 'marta-gtfs-v1'
  | 'miami-gtfs-v1'
  | 'baltimore-gtfs-v1'
  | 'idfm-gtfs-v1'
  | 'vbb-gtfs-v1'
  | 'madrid-gtfs-v1'
  | 'ch-gtfs-v1'
  | 'de-gtfs-v1'
  | 'dk-gtfs-v1'
  | 'ee-gtfs-v1'
  | 'fi-gtfs-v1'
  | 'ie-gtfs-v1'
  | 'lu-gtfs-v1'
  | 'nl-gtfs-v1'
  | 'no-gtfs-v1'
  | 'se-gtfs-v1'
  | 'transitous-v1'
  | 'dot-gtfs';

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
  // ─── United States — OTP / Agency API ─────────────────────────────
  // NYC Subway, PATH, SIR, LIRR, Metro-North → MTA OTP
  // MBTA ("the T", Boston)                   → MBTA V3 API
  // Washington Metro (WMATA)                 → GTFS Static (official feed)
  // Chicago "L" (CTA)                        → GTFS Static (feed URL)
  // SEPTA Metro (Philadelphia)               → GTFS Static (feed URL)
  // BART (SF Bay Area)                       → GTFS Static (official feed)
  // MARTA rail (Atlanta)                     → GTFS Static (feed URL)
  // Metro Rail (LACMTA, LA)                  → GTFS Static (feed URL)
  // Metrorail (Miami-Dade)                   → GTFS Static (feed URL)
  // Baltimore Metro + PATCO                  → GTFS Static (feed URL)

  {
    label: 'MTA New York City & Long Island',
    bbox: [40.4, -74.3, 41.4, -72.0],
    url: 'https://otp-mta-prod.camsys-apps.com/otp/routers/default/plan',
    apiStyle: 'rest-v1',
  },
  {
    label: 'WMATA Washington DC Metro',
    bbox: [38.75, -77.5, 39.2, -76.8],
    url: 'https://api.wmata.com/gtfs/rail-gtfs.zip',
    apiStyle: 'wmata-gtfs-v1',
  },
  {
    label: 'TriMet Portland, OR',
    bbox: [45.2, -123.2, 45.8, -122.2],
    url: 'https://maps.trimet.org/otp_mod/plan',
    apiStyle: 'rest-v1',
  },
  {
    label: 'MBTA Boston & Massachusetts',
    bbox: [41.0, -72.0, 43.0, -70.0],
    url: 'https://api-v3.mbta.com',
    apiStyle: 'mbta-v3',
  },
  {
    label: 'CTA Chicago L',
    bbox: [41.6, -88.0, 42.1, -87.5],
    url: 'https://www.transitchicago.com/downloads/sch_data/google_transit.zip',
    apiStyle: 'cta-gtfs-v1',
  },
  {
    label: 'SEPTA Metro Philadelphia',
    bbox: [39.8, -75.4, 40.2, -74.9],
    url: 'https://www3.septa.org/developer/gtfs_public.zip',
    apiStyle: 'septa-gtfs-v1',
  },
  {
    label: 'BART San Francisco Bay Area',
    bbox: [37.4, -122.6, 38.1, -121.7],
    url: 'https://www.bart.gov/dev/schedules/google_transit.zip',
    apiStyle: 'bart-gtfs-v1',
  },
  {
    label: 'LA Metro Rail',
    bbox: [33.7, -118.5, 34.2, -117.9],
    url: 'https://gitlab.com/LACMTA/gtfs_rail/raw/master/gtfs_rail.zip',
    apiStyle: 'lametro-gtfs-v1',
  },
  {
    label: 'MARTA Rail Atlanta',
    bbox: [33.6, -84.6, 33.9, -84.2],
    url: 'https://www.itsmarta.com/google_transit_feed/google_transit.zip',
    apiStyle: 'marta-gtfs-v1',
  },
  {
    label: 'Miami-Dade Metrorail',
    bbox: [25.6, -80.5, 25.9, -80.1],
    url: 'https://www.miamidade.gov/transit/googletransit/current/google_transit.zip',
    apiStyle: 'miami-gtfs-v1',
  },
  {
    label: 'Baltimore Metro & PATCO',
    bbox: [39.15, -76.8, 39.45, -76.4],
    url: 'https://mdotmta-gtfs.s3.amazonaws.com/mdotmta_gtfs_rail.zip',
    apiStyle: 'baltimore-gtfs-v1',
  },

  // ─── Europe ──────────────────────────────────────────────────────
  // London → TfL Unified API
  // Paris  → GTFS Static (IDFM feed)
  // Berlin → GTFS Static (VBB feed)
  // Madrid → GTFS Static (CRTM feed)

  {
    label: 'TfL London',
    bbox: [51.2, -0.6, 51.75, 0.3],
    url: 'https://api.tfl.gov.uk',
    apiStyle: 'tfl-v1',
  },
  {
    label: 'IDFM Paris Metro',
    bbox: [48.7, 2.0, 49.0, 2.6],
    url: 'https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idf/files/6d4d44e4d99d5b03280ac5bcd08e757a/download',
    apiStyle: 'idfm-gtfs-v1',
  },
  {
    label: 'VBB Berlin',
    bbox: [52.3, 13.0, 52.7, 13.8],
    url: 'https://www.vbb.de/vbbgtfs',
    apiStyle: 'vbb-gtfs-v1',
  },
  {
    label: 'CRTM Madrid Metro',
    bbox: [40.25, -3.9, 40.6, -3.4],
    url: 'https://crtm.maps.arcgis.com/sharing/rest/content/items/...',
    apiStyle: 'madrid-gtfs-v1',
  },

  // ─── Europe — Country-level GTFS feeds (data.public-transport.earth) ──
  // Placed after city-specific endpoints so dedicated infra wins.
  // Each feed is a consolidated GTFS ZIP containing all transit agencies
  // for that country. All modes included (bus, rail, tram, metro, ferry).

  {
    label: 'Switzerland GTFS',
    bbox: [45.8, 5.9, 47.8, 10.5],
    url: 'https://data.public-transport.earth/gtfs/ch',
    apiStyle: 'ch-gtfs-v1',
  },
  {
    label: 'Deutschland GTFS',
    bbox: [47.2, 5.8, 55.1, 15.1],
    url: 'https://data.public-transport.earth/gtfs/de',
    apiStyle: 'de-gtfs-v1',
  },
  {
    label: 'Denmark GTFS',
    bbox: [54.5, 7.5, 57.8, 15.5],
    url: 'https://data.public-transport.earth/gtfs/dk',
    apiStyle: 'dk-gtfs-v1',
  },
  {
    label: 'Estonia GTFS',
    bbox: [57.5, 21.5, 59.7, 28.2],
    url: 'https://data.public-transport.earth/gtfs/ee',
    apiStyle: 'ee-gtfs-v1',
  },
  {
    label: 'Finland GTFS',
    bbox: [59.5, 19.0, 70.1, 31.6],
    url: 'https://data.public-transport.earth/gtfs/fi',
    apiStyle: 'fi-gtfs-v1',
  },
  {
    label: 'Ireland GTFS',
    bbox: [51.4, -10.5, 55.4, -5.5],
    url: 'https://data.public-transport.earth/gtfs/ie',
    apiStyle: 'ie-gtfs-v1',
  },
  {
    label: 'Luxembourg GTFS',
    bbox: [49.4, 5.7, 50.2, 6.5],
    url: 'https://data.public-transport.earth/gtfs/lu',
    apiStyle: 'lu-gtfs-v1',
  },
  {
    label: 'Netherlands GTFS',
    bbox: [50.7, 3.3, 53.6, 7.3],
    url: 'https://data.public-transport.earth/gtfs/nl',
    apiStyle: 'nl-gtfs-v1',
  },
  {
    label: 'Norway GTFS',
    bbox: [57.5, 4.0, 71.2, 31.5],
    url: 'https://data.public-transport.earth/gtfs/no',
    apiStyle: 'no-gtfs-v1',
  },
  {
    label: 'Sweden GTFS',
    bbox: [55.3, 10.5, 69.1, 24.2],
    url: 'https://data.public-transport.earth/gtfs/se',
    apiStyle: 'se-gtfs-v1',
  },

  {
    label: 'Entur Norway (nationwide)',
    bbox: [57.5, 4.0, 71.5, 31.5],
    url: 'https://api.entur.io/journey-planner/v3/graphql',
    apiStyle: 'transmodel-v3',
    headers: { 'ET-Client-Name': 'polaris-maps' },
  },

  // ─── DOT GTFS Registry (US catch-all) ──────────────────────────────
  // Placed after city-specific endpoints so dedicated infra wins.
  // Queries the DOT GTFS Feeds List spatial index and downloads matching
  // GTFS feeds for transit lines in uncovered US regions.
  {
    label: 'DOT GTFS Registry (US)',
    bbox: [24, -125, 50, -66],
    url: '',
    apiStyle: 'dot-gtfs',
  },

  // ─── Global ───────────────────────────────────────────────────────
  // Placed last: findEndpointForCoords returns city-specific endpoints
  // first, falling back to Transitous for worldwide coverage.
  // Line rendering handled by MapLibre vector tiles; routing/departures
  // via MOTIS 2 REST API.
  {
    label: 'Transitous (global)',
    bbox: [-90, -180, 90, 180],
    url: 'https://api.transitous.org/api',
    apiStyle: 'transitous-v1',
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
      const RAIL_PREFIXES = /^(LI|MTASBWY|MNR|NJT|JFK|PATH|RI|HRL|EWR|SIF|AMK):/;
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

  // Sort: exact match first, then prefix match, then substring, then by distance
  return deduped
    .sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      // Exact match (query IS the full name)
      const aExact = an === q ? 0 : 1;
      const bExact = bn === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      // Prefix match (name starts with query)
      const ap = an.startsWith(q) ? 0 : 1;
      const bp = bn.startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      // By distance
      const da = (a.lat - nearLat) ** 2 + (a.lon - nearLon) ** 2;
      const db = (b.lat - nearLat) ** 2 + (b.lon - nearLon) ** 2;
      return da - db;
    })
    .slice(0, 15)
    .map(({ name, lat, lon, id }) => ({ name, lat, lon, id }));
}

// ── Short-lived response caches ─────────────────────────────────────
// The stop card fires overlapping lookups per tap (badges + departures +
// trip prefetch). These collapse duplicate in-flight requests and briefly
// reuse fresh responses. Routes are near-static; stoptimes and trip times
// are realtime so they are shared for seconds only. Empty results are never
// cached (a transient failure must not blank data for a full TTL).

interface TimedEntry {
  value: unknown;
  expiresAt: number;
}

const responseCache = new Map<string, TimedEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

async function cachedJson<T>(key: string, ttlMs: number, loader: () => Promise<T[]>): Promise<T[]> {
  const hit = responseCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T[];
  const ongoing = inflightRequests.get(key);
  if (ongoing) return ongoing as Promise<T[]>;
  const promise = (async (): Promise<T[]> => {
    try {
      const value = await loader();
      if (value.length > 0) {
        responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        if (responseCache.size > 200) {
          const first = responseCache.keys().next().value;
          if (first) responseCache.delete(first);
        }
      }
      return value;
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, promise);
  return promise;
}

/** Exposed for testing. Reset the short-lived response caches. */
export function __clearOtpResponseCache(): void {
  responseCache.clear();
  inflightRequests.clear();
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

  return cachedJson(`${ep.label}|routes|${stopId}`, 5 * 60_000, () =>
    loadOtpRoutesAtStop(ep, stopId),
  );
}

async function loadOtpRoutesAtStop(
  ep: OtpEndpoint,
  stopId: string,
): Promise<Array<{ ref?: string; name?: string; color?: string; mode: TransitMode }>> {
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

// ── Stop ID lookup by name + coordinates ────────────────────────────

/**
 * Find ALL OTP GTFS stop IDs for a station by its name and coordinates.
 * Searches the OTP stops cache (loaded by `ensureStopsLoaded`).
 *
 * A station often has several directional stop IDs sharing one name and
 * location (e.g. MTA City Hall = R24S southbound + R24N northbound at
 * identical coordinates). Callers that need complete departures must query
 * every returned ID — querying just one shows a single direction.
 * Sorted nearest-first; capped to bound downstream fetches.
 */
export async function findOtpStopIds(name: string, lat: number, lon: number): Promise<string[]> {
  const ep = findEndpointForCoords(lat, lon);
  if (!ep) return [];

  // Make sure the stops cache is loaded (wait up to 8s)
  if (!stopsCache.has(ep.label)) {
    const inFlight = stopsFetchInFlight.get(ep.label);
    const loadPromise = inFlight ?? ensureStopsLoaded(ep);
    await Promise.race([loadPromise, new Promise<void>((r) => setTimeout(r, 8_000))]);
  }

  const stops = stopsCache.get(ep.label);
  if (!stops) return [];

  const byDist = (a: { dist: number }, b: { dist: number }) => a.dist - b.dist;
  const q = name.toLowerCase();
  // First pass: exact name matches within ~500m (~0.005°)
  const CLOSE = 0.005;
  const exact: { id: string; dist: number }[] = [];
  for (const s of stops) {
    if (s.name.toLowerCase() !== q) continue;
    const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d > CLOSE * CLOSE) continue;
    exact.push({ id: s.id, dist: d });
  }
  if (exact.length > 0) {
    return exact
      .sort(byDist)
      .slice(0, 6)
      .map((e) => e.id);
  }

  // Second pass: substring matches within ~200m
  const VERY_CLOSE = 0.002;
  const fuzzy: { id: string; dist: number }[] = [];
  for (const s of stops) {
    if (!s.name.toLowerCase().includes(q) && !q.includes(s.name.toLowerCase())) continue;
    const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d > VERY_CLOSE * VERY_CLOSE) continue;
    fuzzy.push({ id: s.id, dist: d });
  }
  return fuzzy
    .sort(byDist)
    .slice(0, 6)
    .map((e) => e.id);
}

/**
 * Find the single best OTP GTFS stop ID for a station.
 * Prefer `findOtpStopIds` when departures for all directions are needed.
 */
export async function findOtpStopId(
  name: string,
  lat: number,
  lon: number,
): Promise<string | null> {
  const ids = await findOtpStopIds(name, lat, lon);
  return ids[0] ?? null;
}

// ── OTP1 REST trip stoptimes (ordered stop list for one trip) ───────

export interface Otp1TripStopTime {
  stopId: string;
  stopName?: string;
  stopLat?: number;
  stopLon?: number;
  stopIndex: number;
  /** Seconds since midnight (service day), like the stop stoptimes */
  scheduledArrival: number;
  scheduledDeparture: number;
  realtimeArrival: number;
  realtimeDeparture: number;
  realtime: boolean;
}

/**
 * Fetch the ordered stop list (with scheduled + realtime times) for a
 * single trip. Used for the trip-detail view when a departure is tapped.
 * Standard OTP1 REST `StopTimeShort` array; empty when unavailable.
 */
export async function fetchOtpTripStoptimes(
  tripId: string,
  lat: number,
  lon: number,
): Promise<Otp1TripStopTime[]> {
  const ep = findEndpointForCoords(lat, lon);
  if (!ep || ep.apiStyle !== 'rest-v1') return [];

  return cachedJson(`${ep.label}|trip|${tripId}`, 30_000, () => loadOtpTripStoptimes(ep, tripId));
}

async function loadOtpTripStoptimes(ep: OtpEndpoint, tripId: string): Promise<Otp1TripStopTime[]> {
  const baseUrl = ep.url.replace(/\/plan$/, '');
  const url = `${baseUrl}/index/trips/${encodeURIComponent(tripId)}/stoptimes`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: ep.headers ?? {},
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Otp1TripStopTime[];
    return [...data].sort((a, b) => a.stopIndex - b.stopIndex);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── OTP1 REST stoptimes (real departures) ───────────────────────────

export interface Otp1StopTime {
  /** Pattern descriptor (e.g. "10:LIRR Port Jeff Branch to Penn Station") */
  pattern: {
    id: string;
    desc?: string;
  };
  /**
   * Route serving this pattern (standard OTP1 `StopTimesInPattern` field,
   * e.g. `{ id: "MTASBWY:W", shortName: "W", longName: "Broadway Local",
   * mode: "SUBWAY", color: "F6BC26" }`). This is the authoritative source
   * for the departure's line — never derive it from the trip ID, whose
   * first segment is the agency/feed ID (e.g. "MTASBWY", the whole network).
   */
  route?: {
    id?: string;
    shortName?: string;
    longName?: string;
    mode?: string;
    color?: string;
  };
  times: Array<{
    /** Seconds since midnight (scheduled departure) */
    scheduledDeparture: number;
    /** Seconds since midnight (real-time departure) */
    realtimeDeparture: number;
    /** Delay in seconds (positive = late) */
    departureDelay: number;
    /** Whether this is a real-time prediction */
    realtime: boolean;
    /** Service day (epoch seconds at midnight) */
    serviceDay: number;
    /** Trip GTFS ID */
    tripId: string;
    /** Trip headsign / terminal (e.g. "86 St") */
    tripHeadsign?: string;
    /** Stop headsign (destination) */
    stopHeadsign?: string;
  }>;
}

/**
 * Fetch upcoming stoptimes at an OTP1 REST stop.
 * Uses `/index/stops/{id}/stoptimes` which returns departures grouped by pattern,
 * including both directions.
 */
export async function fetchOtp1Stoptimes(
  stopId: string,
  lat: number,
  lon: number,
): Promise<Otp1StopTime[]> {
  const ep = findEndpointForCoords(lat, lon);
  if (!ep || ep.apiStyle !== 'rest-v1') return [];

  return cachedJson(`${ep.label}|stoptimes|${stopId}`, 20_000, () => loadOtp1Stoptimes(ep, stopId));
}

async function loadOtp1Stoptimes(ep: OtpEndpoint, stopId: string): Promise<Otp1StopTime[]> {
  const baseUrl = ep.url.replace(/\/plan$/, '');
  const url = `${baseUrl}/index/stops/${encodeURIComponent(stopId)}/stoptimes`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: ep.headers ?? {},
    });
    if (!res.ok) return [];
    return (await res.json()) as Otp1StopTime[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
