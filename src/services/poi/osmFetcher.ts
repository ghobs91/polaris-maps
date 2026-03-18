const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ---------------------------------------------------------------------------
// Bbox-keyed response cache
// ---------------------------------------------------------------------------
// Round coordinates to 2 decimal places (~1.1 km grid) to create a cache key.
// Results expire after 5 minutes so the data stays reasonably fresh.

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

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
 * Only called when zoom >= 14 to avoid huge result sets.
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

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`Overpass API ${res.status}`);

  const data = await res.json();

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
