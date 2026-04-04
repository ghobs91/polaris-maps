import { overpassFetch } from '../overpassClient';

// ---------------------------------------------------------------------------
// Bbox-keyed response cache
// ---------------------------------------------------------------------------
// Round coordinates to 2 decimal places (~1.1 km grid) to create a cache key.
// Results expire after 5 minutes so the data stays reasonably fresh.

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

/** Client-side timeout for Overpass API requests (ms). */
const OVERPASS_TIMEOUT_MS = 8_000;

interface CacheEntry {
  pois: OsmPoi[];
  expiresAt: number;
}

const bboxCache = new Map<string, CacheEntry>();

function bboxKey(south: number, west: number, north: number, east: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(south)},${r(west)},${r(north)},${r(east)}`;
}

function cacheGet(key: string): OsmPoi[] | null {
  const entry = bboxCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    bboxCache.delete(key);
    return null;
  }
  return entry.pois;
}

function cacheSet(key: string, pois: OsmPoi[]): void {
  // Evict oldest entry when full
  if (bboxCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = bboxCache.keys().next().value;
    if (oldestKey !== undefined) bboxCache.delete(oldestKey);
  }
  bboxCache.set(key, { pois, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for testing only. */
export function clearOsmCache(): void {
  bboxCache.clear();
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
export async function fetchOsmPois(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmPoi[]> {
  // Return cached results if we've fetched this bbox recently
  const key = bboxKey(south, west, north, east);
  const cached = cacheGet(key);
  if (cached) return cached;

  const bbox = `${south},${west},${north},${east}`;
  // Include both node and way elements — shops inside shopping centers are
  // almost always mapped as ways (polygon outlines) in OSM, not nodes.
  // `out center` appends a {lat,lon} centroid to each way element.
  const query = `[out:json][timeout:25];
(
  node["amenity"]["name"](${bbox});
  node["shop"]["name"](${bbox});
  node["tourism"]["name"](${bbox});
  node["leisure"]["name"](${bbox});
  way["amenity"]["name"](${bbox});
  way["shop"]["name"](${bbox});
  way["tourism"]["name"](${bbox});
  way["leisure"]["name"](${bbox});
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
      const type = t.amenity ? 'amenity' : t.shop ? 'shop' : t.tourism ? 'tourism' : 'leisure';
      const subtype = t[type] ?? 'place';
      // Nodes have lat/lon directly; ways have a `center` object from `out center`
      const lat: number = el.type === 'node' ? el.lat : el.center?.lat;
      const lng: number = el.type === 'node' ? el.lon : el.center?.lon;
      if (lat == null || lng == null) return null;
      return {
        id: el.id as number,
        lat,
        lng,
        name: t.name,
        type,
        subtype,
        tags: t,
      };
    })
    .filter((p): p is OsmPoi => p !== null);

  cacheSet(key, pois);
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
): Promise<OsmPoi[]> {
  if (tagPairs.length === 0) return [];

  const filterSuffix = (extraFilters ?? []).map(([k, v]) => `["${k}"="${v}"]`).join('');
  const key = `tags:${tagPairs.map((t) => t.join('=')).join('|')}${filterSuffix}:${bboxKey(south, west, north, east)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const bbox = `${south},${west},${north},${east}`;

  // Build Overpass union of node+way queries for each tag pair
  const clauses = tagPairs.flatMap(([k, v]) => [
    `node["${k}"="${v}"]${filterSuffix}["name"](${bbox});`,
    `way["${k}"="${v}"]${filterSuffix}["name"](${bbox});`,
  ]);

  const query = `[out:json][timeout:25];\n(\n  ${clauses.join('\n  ')}\n);\nout body center;`;

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
      return { id: el.id as number, lat, lng, name: t.name, type, subtype, tags: t };
    })
    .filter((p): p is OsmPoi => p !== null);

  cacheSet(key, pois);
  return pois;
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
): Promise<OsmPoi[]> {
  if (!namePattern.trim()) return [];

  // Sanitize the pattern for Overpass regex — escape special regex chars
  // except alphanumerics and spaces
  const safe = namePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const key = `name:${safe}:${bboxKey(south, west, north, east)}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const bbox = `${south},${west},${north},${east}`;

  const query = `[out:json][timeout:25];
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

  cacheSet(key, pois);
  return pois;
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
  const cached = cacheGet(key);
  if (cached) return cached;

  // Nominatim bounded search — query for common POI types visible on a map.
  // We do a few focused queries in parallel to get diverse results.
  const queries = ['restaurant cafe', 'shop supermarket', 'hotel tourism'];

  const allPois: OsmPoi[] = [];
  const poiClasses = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft']);

  await Promise.all(
    queries.map(async (q) => {
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
              ...(item.address?.road ? { 'addr:street': item.address.road } : {}),
              ...((item.address?.city ?? item.address?.town ?? item.address?.village)
                ? { 'addr:city': (item.address.city ?? item.address.town ?? item.address.village)! }
                : {}),
            },
          });
        }
      } catch {
        // Individual query failed — continue with others
      }
    }),
  );

  cacheSet(key, allPois);
  return allPois;
}
