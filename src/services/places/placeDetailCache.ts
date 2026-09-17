import { getDatabase } from '../database/init';

/** A stored place-detail snapshot row. */
export interface PlaceDetailRow {
  canonicalId: string;
  placeId: string | null;
  osmId: string | null;
  name: string;
  lat: number;
  lng: number;
  /** Serialized enrichment snapshot. */
  snapshot: string;
  /** Serialized media metadata, when known. */
  media: string | null;
  /** Serialized reviews snapshot, when known. */
  reviews: string | null;
  sourceVersion: number;
  cachedAt: number;
  lastAccessed: number;
}

export interface PlaceDetailCacheKey {
  placeId?: string | null;
  osmId?: string | null;
  lat: number;
  lng: number;
  name?: string;
}

export const DEFAULT_PLACE_DETAIL_CACHE_MAX = 200;

/** Backend abstraction so the cache is testable without SQLite. */
export interface PlaceDetailCacheBackend {
  upsert(row: PlaceDetailRow): Promise<void>;
  getByKeys(keys: string[]): Promise<PlaceDetailRow[]>;
  updateAccess(canonicalId: string, at: number): Promise<void>;
  count(): Promise<number>;
  deleteMany(ids: string[]): Promise<void>;
  clear(): Promise<void>;
  /** Ids of the least-recently-accessed rows, `limit` of them. */
  oldest(limit: number): Promise<string[]>;
}

/** Primary canonical identifier for a place. */
export function canonicalPlaceKey(key: PlaceDetailCacheKey): string {
  if (key.placeId) return `place:${key.placeId}`;
  if (key.osmId != null && key.osmId !== '') return `osm:${key.osmId}`;
  const name = key.name?.trim().toLowerCase() ?? '';
  return `geo:${key.lat.toFixed(5)},${key.lng.toFixed(5)}${name ? `:${name}` : ''}`;
}

/**
 * All identifiers that could refer to the same place. Lookups try every key so
 * a place viewed from search (osm id) and from a saved list (place uuid) can
 * resolve to one snapshot.
 */
export function candidatePlaceKeys(key: PlaceDetailCacheKey): string[] {
  const keys = new Set<string>([canonicalPlaceKey(key)]);
  if (key.placeId) keys.add(`place:${key.placeId}`);
  if (key.osmId != null && key.osmId !== '') keys.add(`osm:${key.osmId}`);
  keys.add(
    `geo:${key.lat.toFixed(5)},${key.lng.toFixed(5)}${
      key.name?.trim() ? `:${key.name.trim().toLowerCase()}` : ''
    }`,
  );
  return [...keys];
}

function parseRow(row: unknown): PlaceDetailRow {
  const r = row as Record<string, unknown>;
  return {
    canonicalId: String(r.canonical_id ?? r.canonicalId ?? ''),
    placeId: (r.place_id as string | null) ?? (r.placeId as string | null) ?? null,
    osmId: (r.osm_id as string | null) ?? (r.osmId as string | null) ?? null,
    name: String(r.name ?? ''),
    lat: Number(r.lat),
    lng: Number(r.lng),
    snapshot: String(r.snapshot ?? ''),
    media: (r.media as string | null) ?? null,
    reviews: (r.reviews as string | null) ?? null,
    sourceVersion: Number(r.source_version ?? r.sourceVersion ?? 1),
    cachedAt: Number(r.cached_at ?? r.cachedAt ?? 0),
    lastAccessed: Number(r.last_accessed ?? r.lastAccessed ?? 0),
  };
}

class SqlitePlaceDetailCacheBackend implements PlaceDetailCacheBackend {
  async upsert(row: PlaceDetailRow): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO place_detail_cache
        (canonical_id, place_id, osm_id, name, lat, lng, snapshot, media, reviews, source_version, cached_at, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(canonical_id) DO UPDATE SET
         place_id = excluded.place_id,
         osm_id = excluded.osm_id,
         name = excluded.name,
         lat = excluded.lat,
         lng = excluded.lng,
         snapshot = excluded.snapshot,
         media = excluded.media,
         reviews = excluded.reviews,
         source_version = excluded.source_version,
         cached_at = excluded.cached_at,
         last_accessed = excluded.last_accessed`,
      [
        row.canonicalId,
        row.placeId,
        row.osmId,
        row.name,
        row.lat,
        row.lng,
        row.snapshot,
        row.media,
        row.reviews,
        row.sourceVersion,
        row.cachedAt,
        row.lastAccessed,
      ],
    );
  }

  async getByKeys(keys: string[]): Promise<PlaceDetailRow[]> {
    if (keys.length === 0) return [];
    const db = await getDatabase();
    const placeholders = keys.map(() => '?').join(', ');
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM place_detail_cache WHERE canonical_id IN (${placeholders})`,
      keys,
    );
    return rows.map(parseRow);
  }

  async updateAccess(canonicalId: string, at: number): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE place_detail_cache SET last_accessed = ? WHERE canonical_id = ?`, [
      at,
      canonicalId,
    ]);
  }

  async count(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM place_detail_cache`,
    );
    return row?.n ?? 0;
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    await db.runAsync(
      `DELETE FROM place_detail_cache WHERE canonical_id IN (${placeholders})`,
      ids,
    );
  }

  async clear(): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`DELETE FROM place_detail_cache`);
  }

  async oldest(limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ canonical_id: string }>(
      `SELECT canonical_id FROM place_detail_cache ORDER BY last_accessed ASC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => r.canonical_id);
  }
}

let backend: PlaceDetailCacheBackend | null = null;

function getBackend(): PlaceDetailCacheBackend {
  if (!backend) backend = new SqlitePlaceDetailCacheBackend();
  return backend;
}

/** Swap the backend (tests). Pass null to restore the SQLite backend. */
export function setPlaceDetailCacheBackend(next: PlaceDetailCacheBackend | null): void {
  backend = next;
}

/**
 * Read a cached snapshot by any known identifier. Returns the freshest match and
 * refreshes its LRU timestamp.
 */
export async function getPlaceDetail(key: PlaceDetailCacheKey): Promise<PlaceDetailRow | null> {
  const rows = await getBackend().getByKeys(candidatePlaceKeys(key));
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.cachedAt - a.cachedAt || b.sourceVersion - a.sourceVersion);
  const best = rows[0];
  await getBackend().updateAccess(best.canonicalId, Date.now());
  return best;
}

/**
 * Store a snapshot. A snapshot is only replaced by one with an equal-or-newer
 * source version, so region-pack seeds never clobber fresher live data.
 */
export async function putPlaceDetail(
  row: Omit<PlaceDetailRow, 'cachedAt' | 'lastAccessed'> & { cachedAt?: number },
  options: { maxEntries?: number } = {},
): Promise<boolean> {
  const now = Date.now();
  const store = getBackend();
  const existing = await store.getByKeys([row.canonicalId]);
  if (existing.length > 0 && existing[0].sourceVersion > row.sourceVersion) return false;

  await store.upsert({
    ...row,
    cachedAt: row.cachedAt ?? now,
    lastAccessed: now,
  });
  await evictPlaceDetails(options.maxEntries);
  return true;
}

/** Evict least-recently-accessed snapshots beyond the LRU bound. */
export async function evictPlaceDetails(
  maxEntries: number = DEFAULT_PLACE_DETAIL_CACHE_MAX,
): Promise<number> {
  const store = getBackend();
  const count = await store.count();
  const excess = count - maxEntries;
  if (excess <= 0) return 0;
  const ids = await store.oldest(excess);
  await store.deleteMany(ids);
  return ids.length;
}

export async function countPlaceDetailCache(): Promise<number> {
  return getBackend().count();
}

export async function clearPlaceDetailCache(): Promise<void> {
  await getBackend().clear();
}
