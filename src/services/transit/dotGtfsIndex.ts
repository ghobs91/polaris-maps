/**
 * DOT GTFS Index — runtime spatial lookup service.
 *
 * Loads the build-time-generated `dot-gtfs-index.json` (bundled in the app)
 * and provides spatial lookup by lat/lng + radius. Maps viewport coordinates
 * to matching US transit agency GTFS feeds.
 *
 * The index uses 0.1° spatial buckets. Lookup queries buckets overlapping
 * a circular search area, filters by haversine distance, deduplicates by
 * NTD ID + URL, and sorts by UZA population (largest metros first).
 */

/** A single DOT GTFS feed entry from the spatial index. */
export interface DotGtfsFeedEntry {
  id: string;
  ntdId: string;
  agencyName: string;
  city: string;
  state: string;
  modeName: string;
  modeAbbr: string;
  uzaName: string;
  uzaPop: number;
  weblink: string;
  lat: number;
  lng: number;
  dateValidated: string;
  certified: boolean;
}

/** The spatial index JSON structure produced by build-dot-gtfs-index.mjs. */
interface DotGtfsIndexData {
  version: number;
  generatedAt: string;
  bucketSize: number;
  buckets: Record<string, string[]>;
  entries: DotGtfsFeedEntry[];
}

// ── Load / cache ─────────────────────────────────────────────────────

let indexPromise: Promise<DotGtfsIndexData | null> | null = null;
let loadedIndex: DotGtfsIndexData | null = null;

// Try to load the JSON at module level (Metro bundler handles static requires)
/* eslint-disable @typescript-eslint/no-require-imports */
try {
  loadedIndex = require('./dot-gtfs-index.json') as DotGtfsIndexData;
  if (!loadedIndex?.buckets || !loadedIndex?.entries) {
    loadedIndex = null;
  }
} catch {
  // JSON file not bundled — will be loaded lazily with a warning
}
/* eslint-enable @typescript-eslint/no-require-imports */

async function loadIndex(): Promise<DotGtfsIndexData | null> {
  if (loadedIndex) return loadedIndex;
  if (indexPromise) return indexPromise;

  indexPromise = (async () => {
    console.warn('[dot-gtfs] DOT GTFS index not available at startup. Transit coverage limited.');
    return null;
  })();

  return indexPromise;
}

// ── Haversine ────────────────────────────────────────────────────────

function haversineDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // km
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── Lookup ───────────────────────────────────────────────────────────

/**
 * Look up DOT GTFS feeds that cover a geographic area.
 *
 * @param lat  Latitude of the viewport center
 * @param lng  Longitude of the viewport center
 * @param radiusDeg  Search radius in degrees (~1° ≈ 111 km)
 * @param maxFeeds  Maximum number of feeds to return (default 8)
 * @returns  DOT feed entries sorted by UZA population descending
 */
export async function lookupDotGtfsFeeds(
  lat: number,
  lng: number,
  radiusDeg: number,
  maxFeeds = 8,
): Promise<DotGtfsFeedEntry[]> {
  const index = await loadIndex();
  if (!index) return [];

  const bucketSize = index.bucketSize;
  const radiusKm = radiusDeg * 111; // approximate

  // Compute the bounding box of the search area
  const minLat = lat - radiusDeg;
  const maxLat = lat + radiusDeg;
  const minLng = lng - radiusDeg;
  const maxLng = lng + radiusDeg;

  // Compute bucket indices (integer arithmetic to avoid floating-point drift)
  const startLatIdx = Math.floor(minLat / bucketSize);
  const startLngIdx = Math.floor(minLng / bucketSize);
  const endLatIdx = Math.ceil(maxLat / bucketSize);
  const endLngIdx = Math.ceil(maxLng / bucketSize);

  // Collect candidate feed IDs from overlapping buckets
  const candidateIds = new Set<string>();
  for (let li = startLatIdx; li <= endLatIdx; li++) {
    for (let gi = startLngIdx; gi <= endLngIdx; gi++) {
      const key = `${(li * bucketSize).toFixed(1)},${(gi * bucketSize).toFixed(1)}`;
      const bucket = index.buckets[key];
      if (bucket) {
        for (const id of bucket) candidateIds.add(id);
      }
    }
  }

  // Build entry lookup
  const entryMap = new Map<string, DotGtfsFeedEntry>();
  for (const entry of index.entries) {
    entryMap.set(entry.id, entry);
  }

  // Filter by distance and deduplicate by URL
  const results: DotGtfsFeedEntry[] = [];
  const seenUrls = new Set<string>();

  for (const id of candidateIds) {
    const entry = entryMap.get(id);
    if (!entry || !entry.weblink) continue;

    const dist = haversineDeg(lat, lng, entry.lat, entry.lng);

    // Accept if within search radius, or if >100k UZA population (metro area)
    const withinRadius = dist <= radiusKm;
    const majorMetro = entry.uzaPop >= 100_000 && dist <= radiusKm * 3;

    if (!withinRadius && !majorMetro) continue;

    // Deduplicate by URL (same feed covering multiple modes)
    const urlKey = entry.weblink.toLowerCase();
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);

    results.push(entry);
  }

  // Sort by UZA population (largest first), then by distance
  results.sort((a, b) => {
    if (b.uzaPop !== a.uzaPop) return b.uzaPop - a.uzaPop;
    return haversineDeg(lat, lng, a.lat, a.lng) - haversineDeg(lat, lng, b.lat, b.lng);
  });

  return results.slice(0, maxFeeds);
}

/**
 * Get a specific DOT GTFS feed entry by its NTD ID.
 */
export async function getDotGtfsFeedByNtdId(ntdId: string): Promise<DotGtfsFeedEntry | undefined> {
  const index = await loadIndex();
  if (!index) return undefined;
  return index.entries.find((e) => e.ntdId === ntdId);
}

/**
 * Check if the DOT GTFS index is available (bundled and loaded).
 */
export async function isDotGtfsAvailable(): Promise<boolean> {
  const index = await loadIndex();
  return index !== null;
}

/** Exported for testing — inject mock index data. */
export function __setDotGtfsIndex(data: DotGtfsIndexData): void {
  loadedIndex = data;
  indexPromise = Promise.resolve(data);
}

/** Exported for testing — reset cached index. */
export function __clearDotGtfsIndex(): void {
  loadedIndex = null;
  indexPromise = null;
}
