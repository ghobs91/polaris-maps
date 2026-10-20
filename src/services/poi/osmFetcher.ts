import { overpassFetch } from '../overpassClient';
import { throwIfAborted, withTimeout } from '../search/abortUtils';
import { buildOverpassNameRegex, normalizeOsmName } from '../../utils/osmNameMatch';
import {
  classifyOsmMatch,
  derivePrimaryTag,
  matchRadiusMeters,
  type OsmCandidate,
} from './osmMatchScorer';

// ---------------------------------------------------------------------------
// Bbox-keyed response cache
// ---------------------------------------------------------------------------
// Round coordinates to 2 decimal places (~1.1 km grid) to create a cache key.
// Results expire after 5 minutes so the data stays reasonably fresh.

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

/** Client-side timeout for Overpass API requests (ms). */
const OVERPASS_TIMEOUT_MS = 5_000;

/** Client-side timeout for each Nominatim request (ms). Nominatim is a
 * last-resort fallback and must not hold the viewport merge open. */
const NOMINATIM_TIMEOUT_MS = 3_000;

interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface CacheEntry {
  pois: OsmPoi[];
  expiresAt: number;
  /** Exact box the results were fetched for. */
  bounds: Bounds;
}

const bboxCache = new Map<string, CacheEntry>();
/** Shared in-flight Overpass requests, keyed by bbox, so a prefetch and the
 * fetch that follows a gesture settle don't serialize on the throttle. */
const bboxInFlight = new Map<string, { bounds: Bounds; promise: Promise<OsmPoi[]> }>();

function bboxKey(south: number, west: number, north: number, east: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(south)},${r(west)},${r(north)},${r(east)}`;
}

/** True when results fetched for `cached` also answer a request for `requested`. */
function covers(cached: Bounds, requested: Bounds): boolean {
  const epsilon = 1e-6;
  return (
    cached.south <= requested.south + epsilon &&
    cached.north >= requested.north - epsilon &&
    cached.west <= requested.west + epsilon &&
    cached.east >= requested.east - epsilon
  );
}

/**
 * Read cached results for a request, but only when the entry was fetched for a
 * box that *covers* it. The rounded key is shared by every viewport inside a
 * ~1.1 km cell, and a street-level viewport is a few hundred metres: reusing a
 * neighbour's smaller result set (e.g. one restaurant) for a bigger view makes
 * a busy area look empty. A miss refetches instead of under-reporting.
 */
function cacheGet(key: string, bounds: Bounds): OsmPoi[] | null {
  const entry = bboxCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    bboxCache.delete(key);
    return null;
  }
  return covers(entry.bounds, bounds) ? entry.pois : null;
}

function cacheSet(key: string, pois: OsmPoi[], bounds: Bounds): void {
  // Evict oldest entry when full
  if (bboxCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = bboxCache.keys().next().value;
    if (oldestKey !== undefined) bboxCache.delete(oldestKey);
  }
  bboxCache.set(key, { pois, expiresAt: Date.now() + CACHE_TTL_MS, bounds });
}

/** Exposed for testing only. */
export function clearOsmCache(): void {
  bboxCache.clear();
  bboxInFlight.clear();
}

export interface OsmPoi {
  id: number;
  lat: number;
  lng: number;
  name: string;
  /** Primary OSM tag key: amenity | shop | tourism | leisure */
  type: string;
  /** Value of that tag e.g. restaurant, cafe, supermarket */
  subtype: string;
  tags: Record<string, string>;
}

/**
 * Fetch named POIs from the OSM Overpass API for a bounding box.
 * Only called when zoom >= 15 (POI_MIN_ZOOM) to avoid huge result sets.
 */
export function fetchOsmPois(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmPoi[]> {
  const bounds: Bounds = { south, west, north, east };
  // Return cached results if we've fetched a box covering this one recently
  const key = bboxKey(south, west, north, east);
  const cached = cacheGet(key, bounds);
  if (cached) return Promise.resolve(cached);

  // Share an in-flight request for the same bbox (e.g. a mid-gesture prefetch
  // and the fetch that runs once the gesture settles) — but only when it
  // covers this request, so a smaller in-flight fetch can't answer a bigger box.
  const pending = bboxInFlight.get(key);
  if (pending && covers(pending.bounds, bounds)) return pending.promise;

  const promise = fetchOsmPoisUncached(south, west, north, east, key);
  bboxInFlight.set(key, { bounds, promise });
  void promise
    .finally(() => {
      if (bboxInFlight.get(key)?.promise === promise) bboxInFlight.delete(key);
    })
    .catch(() => {});
  return promise;
}

async function fetchOsmPoisUncached(
  south: number,
  west: number,
  north: number,
  east: number,
  key: string,
): Promise<OsmPoi[]> {
  const bbox = `${south},${west},${north},${east}`;
  // Include both node and way elements — shops inside shopping centers are
  // almost always mapped as ways (polygon outlines) in OSM, not nodes.
  // `out center` appends a {lat,lon} centroid to each way element.
  const query = `[out:json][timeout:8];
(
  node["amenity"]["name"](${bbox});
  node["shop"]["name"](${bbox});
  node["tourism"]["name"](${bbox});
  node["leisure"]["name"](${bbox});
  node["office"]["name"](${bbox});
  node["craft"]["name"](${bbox});
  node["healthcare"]["name"](${bbox});
  way["amenity"]["name"](${bbox});
  way["shop"]["name"](${bbox});
  way["tourism"]["name"](${bbox});
  way["leisure"]["name"](${bbox});
  way["office"]["name"](${bbox});
  way["craft"]["name"](${bbox});
  way["healthcare"]["name"](${bbox});
);
out body center;`;

  const data = await overpassFetch<{ elements: any[] }>({
    query,
    timeoutMs: OVERPASS_TIMEOUT_MS,
  });

  const pois = (data.elements as any[])
    .filter((el) => (el.type === 'node' || el.type === 'way') && el.tags?.name)
    .map((el) => {
      const t = el.tags as Record<string, string>;
      const type = t.amenity
        ? 'amenity'
        : t.shop
          ? 'shop'
          : t.tourism
            ? 'tourism'
            : t.leisure
              ? 'leisure'
              : t.office
                ? 'office'
                : t.healthcare
                  ? 'healthcare'
                  : 'craft';
      const subtype = t[type] ?? 'place';
      // Nodes have lat/lon directly; ways have a `center` object from `out center`
      const lat: number = el.type === 'node' ? el.lat : el.center?.lat;
      const lng: number = el.type === 'node' ? el.lon : el.center?.lon;
      if (lat == null || lng == null) return null;
      // Record the element type: a way id is NOT a node id, so the editor
      // affordance must not hand it to the node editor (see `isOsmNodePoi`).
      const tags: Record<string, string> = { ...t, 'polaris:osmType': el.type as string };
      return {
        id: el.id as number,
        lat,
        lng,
        name: t.name,
        type,
        tags,
        subtype,
      };
    })
    .filter((p): p is OsmPoi => p !== null);

  cacheSet(key, pois, { south, west, north, east });
  return pois;
}

/**
 * Fetch POIs from Overpass for specific OSM tag pairs within a bounding box.
 * Used as a fallback when local Overture data has insufficient results for
 * a category search.
 *
 * @param tagPairs - Array of [key, value] tuples e.g. [['amenity', 'cafe'], ['shop', 'coffee']]
 */
export async function fetchOsmPoisByTags(
  south: number,
  west: number,
  north: number,
  east: number,
  tagPairs: Array<[string, string]>,
  /** Extra tag filters ANDed onto every clause (e.g. cuisine=pizza). */
  extraFilters?: Array<[string, string]>,
  /** When false, don't require a `name` tag — include unnamed POIs. Default: true. */
  options?: { requireName?: boolean; signal?: AbortSignal },
): Promise<OsmPoi[]> {
  if (tagPairs.length === 0) return [];
  throwIfAborted(options?.signal);

  const requireName = options?.requireName ?? true;

  const filterSuffix = (extraFilters ?? [])
    .map(([k, v]) => `["${k.replace(/"/g, '')}"="${v.replace(/"/g, '')}"]`)
    .join('');
  const nameSuffix = requireName ? '["name"]' : '';
  const key = `tags:${tagPairs.map((t) => t.join('=')).join('|')}${filterSuffix}:rn${requireName ? '1' : '0'}:${bboxKey(south, west, north, east)}`;
  const cached = cacheGet(key, { south, west, north, east });
  if (cached) return cached;

  const bbox = `${south},${west},${north},${east}`;

  // Build Overpass union of node+way queries for each tag pair.
  // Disabling requireName fetches POIs without a name tag (e.g. EV chargers).
  const clauses = tagPairs.flatMap(([k, v]) => [
    `node["${k}"="${v}"]${filterSuffix}${nameSuffix}(${bbox});`,
    `way["${k}"="${v}"]${filterSuffix}${nameSuffix}(${bbox});`,
  ]);

  const query = `[out:json][timeout:8];\n(\n  ${clauses.join('\n  ')}\n);\nout body center;`;

  const data = await overpassFetch<{ elements: any[] }>({
    query,
    timeoutMs: OVERPASS_TIMEOUT_MS,
    signal: options?.signal,
  });

  const pois = (data.elements as any[])
    .filter((el) => (el.type === 'node' || el.type === 'way') && (!requireName || el.tags?.name))
    .map((el) => {
      const t = el.tags as Record<string, string>;
      const type = t.amenity
        ? 'amenity'
        : t.shop
          ? 'shop'
          : t.tourism
            ? 'tourism'
            : t.leisure
              ? 'leisure'
              : t.railway
                ? 'railway'
                : t.aeroway
                  ? 'aeroway'
                  : t.natural
                    ? 'natural'
                    : 'amenity';
      const subtype = t[type] ?? 'place';
      const lat: number = el.type === 'node' ? el.lat : el.center?.lat;
      const lng: number = el.type === 'node' ? el.lon : el.center?.lon;
      if (lat == null || lng == null) return null;
      // Fall back to operator name or tag value for unnamed POIs (e.g. "EV Charging Station")
      const name = t.name ?? t.operator ?? `${capitaliseTag(subtype)}`;
      return { id: el.id as number, lat, lng, name, type, subtype, tags: t };
    })
    .filter((p): p is OsmPoi => p !== null);

  cacheSet(key, pois, { south, west, north, east });
  return pois;
}

/** Capitalise a tag value for display (e.g. "charging_station" → "Charging Station"). */
function capitaliseTag(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fetch POIs from Overpass whose name matches a case-insensitive regex.
 * Searches across amenity, shop, tourism, and leisure nodes/ways.
 *
 * Used as a fallback when tag-based category search doesn't find enough
 * results — catches places like "Turnpike Bagels Deli & Bakery" that
 * have the search term in their name but might be tagged differently.
 */
export async function fetchOsmPoisByName(
  south: number,
  west: number,
  north: number,
  east: number,
  namePattern: string,
  opts?: { signal?: AbortSignal },
): Promise<OsmPoi[]> {
  if (!namePattern.trim()) return [];
  throwIfAborted(opts?.signal);

  // Sanitize the pattern for Overpass regex — escape special regex chars
  // except alphanumerics and spaces
  const safe = namePattern.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');

  const key = `name:${safe}:${bboxKey(south, west, north, east)}`;
  const cached = cacheGet(key, { south, west, north, east });
  if (cached) return cached;

  const bbox = `${south},${west},${north},${east}`;

  const query = `[out:json][timeout:8];
(
  node["name"~"${safe}",i]["amenity"](${bbox});
  node["name"~"${safe}",i]["shop"](${bbox});
  node["name"~"${safe}",i]["tourism"](${bbox});
  node["name"~"${safe}",i]["leisure"](${bbox});
  way["name"~"${safe}",i]["amenity"](${bbox});
  way["name"~"${safe}",i]["shop"](${bbox});
  way["name"~"${safe}",i]["tourism"](${bbox});
  way["name"~"${safe}",i]["leisure"](${bbox});
);
out body center;`;

  const data = await overpassFetch<{ elements: any[] }>({
    query,
    timeoutMs: OVERPASS_TIMEOUT_MS,
    signal: opts?.signal,
  });

  const pois = (data.elements as any[])
    .filter((el) => (el.type === 'node' || el.type === 'way') && el.tags?.name)
    .map((el: any) => {
      const t = el.tags as Record<string, string>;
      const type = t.amenity ? 'amenity' : t.shop ? 'shop' : t.tourism ? 'tourism' : 'leisure';
      const subtype = t[type] ?? 'place';
      const lat: number = el.type === 'node' ? el.lat : el.center?.lat;
      const lng: number = el.type === 'node' ? el.lon : el.center?.lon;
      if (lat == null || lng == null) return null;
      return { id: el.id as number, lat, lng, name: t.name, type, subtype, tags: t };
    })
    .filter((p: any): p is OsmPoi => p !== null);

  cacheSet(key, pois, { south, west, north, east });
  return pois;
}

// ---------------------------------------------------------------------------
// Pre-submission existence check (Overture → OSM auto-seed guard)
// ---------------------------------------------------------------------------

/** Name-bearing keys searched before scoring candidates locally. */
const EXISTS_NAME_QUERY_KEYS = [
  'name',
  'name:en',
  'alt_name',
  'official_name',
  'short_name',
  'brand',
  'operator',
];

/** Existence results are cached briefly so repeated selections are cheap. */
const EXISTS_CACHE_TTL_MS = 10 * 60 * 1000;
const EXISTS_CACHE_MAX = 200;

interface ExistsCacheEntry {
  value: boolean;
  expiresAt: number;
}

const existsCache = new Map<string, ExistsCacheEntry>();

function existsCacheKey(
  lat: number,
  lng: number,
  name: string,
  tags: Record<string, string>,
): string {
  const r = (n: number) => Math.round(n * 10_000) / 10_000; // ~11m precision
  const primary = derivePrimaryTag(tags);
  return [
    r(lat),
    r(lng),
    normalizeOsmName(name),
    primary ? `${primary.type}=${primary.value}` : '',
    tags['brand:wikidata'] ?? '',
  ].join('|');
}

/** Normalize Overpass elements (nodes carry lat/lon, areas carry `center`). */
function parseOverpassCandidates(elements: unknown[]): OsmCandidate[] {
  const candidates: OsmCandidate[] = [];
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const elObj = el as {
      type?: string;
      id?: number;
      lat?: number;
      lon?: number;
      center?: { lat?: number; lon?: number };
      tags?: Record<string, string>;
    };
    const lat = typeof elObj.lat === 'number' ? elObj.lat : elObj.center?.lat;
    const lng = typeof elObj.lon === 'number' ? elObj.lon : elObj.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    candidates.push({
      type: typeof elObj.type === 'string' ? elObj.type : 'node',
      id: typeof elObj.id === 'number' ? elObj.id : 0,
      lat,
      lng,
      tags: elObj.tags && typeof elObj.tags === 'object' ? elObj.tags : {},
    });
  }
  return candidates;
}

/**
 * Overpass name/brand/operator search near a point, scored locally against the
 * place. Shared by the pre-submission existence check and the edit resolver so
 * both apply exactly the same matching rules.
 */
async function queryOsmMatches(
  lat: number,
  lng: number,
  name: string,
  tags: Record<string, string>,
): Promise<OsmCandidate[]> {
  const regex = buildOverpassNameRegex(name);
  if (!regex) return [];

  const radius = matchRadiusMeters(tags);
  const clauses = EXISTS_NAME_QUERY_KEYS.map(
    (key) => `nwr["${key}"~"${regex}",i](around:${radius},${lat},${lng});`,
  ).join('\n  ');
  const query = `[out:json][timeout:15];\n(\n  ${clauses}\n);\nout center tags;`;

  const data = await overpassFetch<{ elements: unknown[] }>({
    query,
    timeoutMs: 15_000,
  });

  const target = { name, lat, lng, tags };
  return parseOverpassCandidates(data.elements ?? []).filter(
    (candidate) => classifyOsmMatch(target, candidate).match,
  );
}

/**
 * Check whether a place with the given name/tags already exists near the given
 * coordinates in OpenStreetMap.
 *
 * Queries Overpass for nodes, ways and relations matching any of the place's
 * distinctive name tokens (or its name/brand/operator tags) within a
 * category-aware radius, then scores each candidate locally on name
 * similarity, category compatibility, distance and strong identifiers
 * (brand Wikidata, phone, website).
 *
 * The check is deliberately conservative: a place only counts as "already
 * mapped" when a candidate is a confident match. Callers should treat a thrown
 * error as "unverified" and skip submission rather than risk a duplicate.
 *
 * @param tags OSM-style tags for the place (used for category/identifier
 *   signals); optional for backward compatibility.
 * @returns true if a confident matching POI exists, false otherwise.
 * @throws on Overpass API errors.
 */
export async function checkPoiExistsInOsm(
  lat: number,
  lng: number,
  name: string,
  tags: Record<string, string> = {},
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const cacheKey = existsCacheKey(lat, lng, trimmed, tags);
  const cached = existsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const exists = (await queryOsmMatches(lat, lng, trimmed, tags)).length > 0;

  // Cache the result (evict oldest when full)
  if (existsCache.size >= EXISTS_CACHE_MAX) {
    const oldestKey = existsCache.keys().next().value;
    if (oldestKey !== undefined) existsCache.delete(oldestKey);
  }
  existsCache.set(cacheKey, { value: exists, expiresAt: Date.now() + EXISTS_CACHE_TTL_MS });

  return exists;
}

/** Clear the existence check cache (exposed for testing). */
export function clearExistenceCache(): void {
  existsCache.clear();
}

// ---------------------------------------------------------------------------
// OSM element resolution for editing (Overture/saved/geocode → OSM node)
// ---------------------------------------------------------------------------

/** A confident OSM element match for a place, as returned by {@link findOsmPlaceMatch}. */
export interface OsmPlaceMatch {
  type: 'node' | 'way' | 'relation';
  id: number;
}

const placeMatchCache = new Map<string, { value: OsmPlaceMatch | null; expiresAt: number }>();

/**
 * Resolve the OSM element a place is already mapped as, so a place rendered from
 * another source (Overture, saved list, geocode) can be edited in OSM.
 *
 * Uses the same query and scoring as {@link checkPoiExistsInOsm}, so "mapped"
 * means the same thing in both. A matching *node* is preferred, because a node
 * is the only element type the editor can update; a way/relation match is still
 * reported so callers can distinguish "already mapped, but not editable here"
 * from "not mapped at all".
 *
 * @returns the matched element, or null when nothing matches confidently.
 * @throws on Overpass API errors.
 */
export async function findOsmPlaceMatch(
  lat: number,
  lng: number,
  name: string,
  tags: Record<string, string> = {},
): Promise<OsmPlaceMatch | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const cacheKey = existsCacheKey(lat, lng, trimmed, tags);
  const cached = placeMatchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const matches = await queryOsmMatches(lat, lng, trimmed, tags);
  const preferred = matches.find((candidate) => candidate.type === 'node') ?? matches[0];
  const value: OsmPlaceMatch | null = preferred
    ? { type: preferred.type as OsmPlaceMatch['type'], id: preferred.id }
    : null;

  if (placeMatchCache.size >= EXISTS_CACHE_MAX) {
    const oldestKey = placeMatchCache.keys().next().value;
    if (oldestKey !== undefined) placeMatchCache.delete(oldestKey);
  }
  placeMatchCache.set(cacheKey, { value, expiresAt: Date.now() + EXISTS_CACHE_TTL_MS });

  return value;
}

/** Clear the place-match cache (exposed for testing). */
export function clearPlaceMatchCache(): void {
  placeMatchCache.clear();
}

/**
 * Fetch general POIs from Nominatim for a bounding box.
 * Used as a fallback when Overpass API is unavailable/rate-limited.
 * Queries for common amenity types the user would expect on a map.
 */
export async function fetchNominatimPois(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmPoi[]> {
  const key = `nom:${bboxKey(south, west, north, east)}`;
  const cached = cacheGet(key, { south, west, north, east });
  if (cached) return cached;

  // Nominatim bounded search — query for common POI types visible on a map.
  // We do a few focused queries in parallel to get diverse results.
  const queries = ['restaurant cafe', 'shop supermarket', 'hotel tourism'];

  const allPois: OsmPoi[] = [];
  const poiClasses = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft']);

  await Promise.all(
    queries.map(async (q) => {
      const { signal, cleanup } = withTimeout(undefined, NOMINATIM_TIMEOUT_MS);
      try {
        const params = new URLSearchParams({
          q,
          format: 'jsonv2',
          viewbox: `${west},${north},${east},${south}`,
          bounded: '1',
          limit: '20',
          addressdetails: '1',
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
          {
            headers: { 'User-Agent': 'PolarisMaps/1.0', Accept: 'application/json' },
            signal,
          },
        );
        if (!response.ok) return;

        const data: Array<{
          place_id: number;
          lat: string;
          lon: string;
          display_name: string;
          type: string;
          class: string;
          address?: { city?: string; town?: string; village?: string; road?: string };
        }> = await response.json();

        for (const item of data) {
          if (!poiClasses.has(item.class)) continue;
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          if (isNaN(lat) || isNaN(lng)) continue;
          const shortName = item.display_name.split(',')[0].trim();
          allPois.push({
            id: item.place_id,
            lat,
            lng,
            name: shortName,
            type: item.class,
            subtype: item.type,
            tags: {
              [item.class]: item.type,
              name: shortName,
              // Nominatim's `place_id` is NOT an OSM element id; tag the source
              // so callers never treat it as one (see `isOsmNodePoi`).
              'polaris:source': 'nominatim',
              ...(item.address?.road ? { 'addr:street': item.address.road } : {}),
              ...((item.address?.city ?? item.address?.town ?? item.address?.village)
                ? { 'addr:city': (item.address.city ?? item.address.town ?? item.address.village)! }
                : {}),
            },
          });
        }
      } catch {
        // Individual query failed or timed out — continue with others
      } finally {
        cleanup();
      }
    }),
  );

  cacheSet(key, allPois, { south, west, north, east });
  return allPois;
}
