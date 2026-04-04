/**
 * Fetches transit stops for map rendering.
 *
 * Data sources (in priority order):
 *   1. OpenTripPlanner GTFS GraphQL API (if EXPO_PUBLIC_OTP_BASE_URL is set)
 *   2. Overpass API (OpenStreetMap) — always available, no config needed
 *
 * Both sources produce OtpStop-compatible objects so TransitLayer can
 * render them identically.
 */

import { getStopsInBounds, isUserOtpConfigured } from './transitRoutingService';
import type { OtpStop, TransitMode } from '../../models/transit';
import { overpassFetch } from '../overpassClient';

const OVERPASS_TIMEOUT_MS = 12_000;

// ── Overpass cache ──────────────────────────────────────────────────

interface CacheEntry {
  stops: OtpStop[];
  expiresAt: number;
}

const stopCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 30;

function cacheKey(s: number, w: number, n: number, e: number): string {
  const r = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  return `${r(s)},${r(w)},${r(n)},${r(e)}`;
}

// ── OSM → OtpStop mapping ───────────────────────────────────────────

function osmModeToTransit(tags: Record<string, string>): TransitMode | null {
  if (tags.station === 'subway' || tags.subway === 'yes') return 'SUBWAY';
  if (tags.railway === 'tram_stop' || tags.railway === 'halt') return 'TRAM';
  if (tags.amenity === 'ferry_terminal' || tags.route === 'ferry') return null;
  if (tags.railway === 'station' || tags.railway === 'stop' || tags.train === 'yes') return 'RAIL';
  if (tags.highway === 'bus_stop' || tags.bus === 'yes' || tags.route === 'bus') return null;
  if (tags.public_transport === 'station') {
    if (tags.subway === 'yes') return 'SUBWAY';
    if (tags.railway) return 'RAIL';
    return null;
  }
  return null;
}

function osmColor(mode: TransitMode, tags: Record<string, string>): string | undefined {
  // Some OSM features store a colour tag
  const c = tags.colour ?? tags.color;
  if (c && /^#?[0-9A-Fa-f]{6}$/.test(c)) return c.replace('#', '');
  return undefined;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function elementToStop(el: OverpassElement): OtpStop | null {
  const tags = el.tags ?? {};
  const name = tags.name;
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const mode = osmModeToTransit(tags);
  if (!mode) return null;
  const color = osmColor(mode, tags);

  return {
    gtfsId: `osm:${el.type}:${el.id}`,
    name,
    code: tags.ref ?? tags.local_ref ?? undefined,
    lat,
    lon,
    routes: color
      ? [
          {
            gtfsId: `osm:route:${el.id}`,
            shortName: tags.ref,
            longName: tags.operator ?? tags.network,
            color,
            mode,
          },
        ]
      : [],
    vehicleMode: mode,
  };
}

// ── Overpass query ───────────────────────────────────────────────────

async function fetchTransitStopsOverpass(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<OtpStop[]> {
  const key = cacheKey(minLat, minLng, maxLat, maxLng);
  const cached = stopCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.stops;

  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;

  // Query for subway stations, railway stations/stops, tram stops (no bus or ferry)
  const query = `[out:json][timeout:25];
(
  node["railway"="station"](${bbox});
  node["railway"="halt"](${bbox});
  node["railway"="tram_stop"](${bbox});
  node["station"="subway"](${bbox});
  node["public_transport"="stop_position"]["name"](${bbox});
  way["railway"="station"](${bbox});
  way["station"="subway"](${bbox});
  way["public_transport"="station"](${bbox});
  relation["railway"="station"](${bbox});
  relation["station"="subway"](${bbox});
);
out body center;`;

  if (__DEV__) console.warn('[Overpass] fetching transit stops for bbox:', bbox);

  const data = await overpassFetch<{ elements: OverpassElement[] }>({
    query,
    timeoutMs: OVERPASS_TIMEOUT_MS,
  });

  if (__DEV__) console.warn('[Overpass] elements:', data.elements?.length ?? 0);

  // Deduplicate — OSM often has overlapping node/way/relation for the same station
  const seen = new Map<string, OtpStop>();
  for (const el of data.elements) {
    const stop = elementToStop(el);
    if (!stop) continue;
    // Deduplicate by rounding to ~50m grid
    const dedupeKey = `${stop.name}:${(stop.lat * 200).toFixed(0)},${(stop.lon * 200).toFixed(0)}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, stop);
    }
  }

  const stops = [...seen.values()];

  // Cache the result
  if (stopCache.size >= CACHE_MAX) {
    const first = stopCache.keys().next().value;
    if (first) stopCache.delete(first);
  }
  stopCache.set(key, { stops, expiresAt: Date.now() + CACHE_TTL_MS });

  return stops;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch transit stops for the given bounding box.
 * Uses OTP if configured, otherwise falls back to Overpass (OSM).
 */
export async function fetchTransitStops(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<OtpStop[]> {
  if (isUserOtpConfigured()) {
    const stops = await getStopsInBounds(minLat, minLng, maxLat, maxLng);
    // Exclude bus stops and ferry terminals from map display
    return stops.filter((s) => s.vehicleMode !== 'BUS' && s.vehicleMode !== 'FERRY');
  }
  return fetchTransitStopsOverpass(minLat, minLng, maxLat, maxLng);
}
