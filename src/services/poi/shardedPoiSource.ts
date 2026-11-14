/**
 * Shard-fetching POI source (Tier 1 consumer).
 *
 * A downloaded region pack answers every viewport. A *partial* pack — or one the
 * user has not downloaded but happens to sit near seeded data — does not. This
 * module fills that gap without a query service: it picks the shard cells that
 * intersect the viewport, fetches their bytes (pack-local read first, then
 * peers), verifies each against its committed hash and Merkle root, and writes
 * the rows into the same on-device index the covered case uses.
 *
 * After one fetch the area is *covered*, so subsequent queries hit tier 0 and
 * nothing is fetched again. Shards are therefore a warm-up path, not a per-pan
 * network dependency.
 *
 * Trust: `fetchVerifiedShard` refuses bytes that do not hash to the descriptor,
 * and the Merkle root lets the caller prove each entry came from the committed
 * set. If the descriptors themselves came from a signed shard manifest
 * (`regionManifest`-style signature, publisher-verified), the set is
 * authenticated too; an unsigned `shards.json` gives content integrity only.
 */

import { getDatabase } from '../database/init';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  fetchVerifiedShard,
  shardForPoint,
  shardsForBounds,
  type ShardDescriptor,
  type ShardSource,
} from '../regions/shardManifest';
import { ensureLocalPoiSchema, recordLocalPoiCoverage, upsertLocalPois } from './localPoiIndex';
import type { OsmPoi } from './osmFetcher';
import { buildShardRoot, type ShardEntry } from './verifiableShardIndex';

/** Cache table: which shard bytes are already in the local index. */
export const SHARD_CACHE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS poi_shard_cache (
    shard_id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    poi_count INTEGER NOT NULL DEFAULT 0,
    south REAL NOT NULL,
    west REAL NOT NULL,
    north REAL NOT NULL,
    east REAL NOT NULL,
    region_id TEXT NOT NULL,
    merkle_root TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_poi_shard_cache_bounds
    ON poi_shard_cache (south, north, west, east);
`;

export interface ShardCacheRow {
  shard_id: string;
  sha256: string;
  poi_count: number;
}

/** SQL that answers "is this exact shard version already imported?". */
export function buildShardCacheLookup(shardIds: readonly string[]): {
  sql: string;
  params: string[];
} {
  if (shardIds.length === 0) {
    return { sql: 'SELECT shard_id, sha256, poi_count FROM poi_shard_cache WHERE 0', params: [] };
  }
  return {
    sql: `SELECT shard_id, sha256, poi_count FROM poi_shard_cache
           WHERE shard_id IN (${shardIds.map(() => '?').join(', ')})`,
    params: [...shardIds],
  };
}

export interface ShardSourceConfig {
  /** Descriptor sets — one per pack the device has imported. */
  shardSets: ShardDescriptor[][];
  /** Reader order: pack-local files first, then peers, then archives. */
  sources: ShardSource[];
}

let _config: ShardSourceConfig = { shardSets: [], sources: [] };
let _schemaReady: Promise<void> | null = null;
/** Boxes we already tried and could not cover, so a pan does not re-probe. */
const _misses = new Map<string, number>();
const MISS_TTL_MS = 5 * 60 * 1000;

/** Register the descriptors and byte sources available on this device. */
export function configureShardSources(next: Partial<ShardSourceConfig>): void {
  _config = {
    shardSets: next.shardSets ?? _config.shardSets,
    sources: next.sources ?? _config.sources,
  };
  _misses.clear();
}

export function getShardSources(): ShardSourceConfig {
  return _config;
}

/** Exposed for testing only. */
export function __resetShardSourcesForTests(): void {
  _config = { shardSets: [], sources: [] };
  _misses.clear();
  _schemaReady = null;
}

async function ensureShardSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = getDatabase()
      .then((db) => db.execAsync(SHARD_CACHE_SCHEMA_SQL))
      .catch((err) => {
        _schemaReady = null;
        throw err;
      });
  }
  return _schemaReady;
}

/** Parse a JSONL shard payload produced by `scripts/build-search-shards.mjs`. */
export function parseShardPayload(bytes: Uint8Array): ShardEntry[] {
  const text = new TextDecoder().decode(bytes);
  const entries: ShardEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as ShardEntry;
    entries.push(parsed);
  }
  return entries;
}

/** Map a committed shard entry onto the local index's POI shape. */
export function shardEntryToPoi(entry: ShardEntry): OsmPoi & {
  osmType: ShardEntry['osmType'];
} {
  return {
    id: entry.osmId,
    lat: entry.lat,
    lng: entry.lng,
    name: entry.name,
    type: entry.primaryKey,
    subtype: entry.subtype,
    tags: entry.tags,
    osmType: entry.osmType,
  };
}

function missKey(bounds: { south: number; west: number; north: number; east: number }): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(bounds.south)},${r(bounds.west)},${r(bounds.north)},${r(bounds.east)}`;
}

/** Shards covering a point, across every registered descriptor set. */
export function shardDescriptorsForPoint(
  shardSets: ReadonlyArray<readonly ShardDescriptor[]>,
  lat: number,
  lng: number,
): ShardDescriptor[] {
  const found: ShardDescriptor[] = [];
  for (const shards of shardSets) {
    const shard = shardForPoint(shards, lat, lng);
    if (shard) found.push(shard);
  }
  return found;
}

async function readCachedShards(shardIds: readonly string[]): Promise<Map<string, ShardCacheRow>> {
  const cached = new Map<string, ShardCacheRow>();
  if (shardIds.length === 0) return cached;
  const db = await getDatabase();
  const { sql, params } = buildShardCacheLookup(shardIds);
  const rows = await db.getAllAsync<ShardCacheRow>(sql, params);
  for (const row of rows) cached.set(row.shard_id, row);
  return cached;
}

async function markShardCached(descriptor: ShardDescriptor, regionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO poi_shard_cache
       (shard_id, sha256, poi_count, south, west, north, east, region_id, merkle_root, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (shard_id) DO UPDATE SET
       sha256 = excluded.sha256,
       poi_count = excluded.poi_count,
       south = excluded.south,
       west = excluded.west,
       north = excluded.north,
       east = excluded.east,
       region_id = excluded.region_id,
       merkle_root = excluded.merkle_root,
       fetched_at = excluded.fetched_at`,
    [
      descriptor.shardId,
      descriptor.sha256,
      descriptor.poiCount,
      descriptor.south,
      descriptor.west,
      descriptor.north,
      descriptor.east,
      regionId,
      descriptor.merkleRoot,
      Date.now(),
    ],
  );
}

function regionIdForShard(descriptor: ShardDescriptor): string {
  return `shard:${descriptor.shardId}`;
}

export interface ShardFetchResult {
  shardsFetched: number;
  shardsCached: number;
  entries: number;
  failures: number;
}

/**
 * Fetch and index any intersecting shard that is not already in the local index.
 *
 * Never throws: a shard that cannot be fetched is logged and skipped, so a
 * partial manifest still improves coverage. Returns counts for diagnostics.
 */
export async function ensureShardCoverage(bounds: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<ShardFetchResult> {
  const empty: ShardFetchResult = { shardsFetched: 0, shardsCached: 0, entries: 0, failures: 0 };
  if (_config.shardSets.length === 0 || _config.sources.length === 0) return empty;

  const key = missKey(bounds);
  const missedAt = _misses.get(key);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return empty;

  const candidates = _config.shardSets.flatMap((shards) => shardsForBounds(shards, bounds));
  if (candidates.length === 0) {
    _misses.set(key, Date.now());
    return empty;
  }

  const deduped = new Map<string, ShardDescriptor>();
  for (const descriptor of candidates) deduped.set(descriptor.shardId, descriptor);

  try {
    await ensureShardSchema();
    await ensureLocalPoiSchema();
  } catch (err) {
    logDiagnostic('shards', 'warn', 'shard schema unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }

  const cached = await readCachedShards([...deduped.keys()]);
  const result: ShardFetchResult = { ...empty };

  for (const descriptor of deduped.values()) {
    const hit = cached.get(descriptor.shardId);
    if (hit && hit.sha256 === descriptor.sha256) {
      result.shardsCached += 1;
      continue;
    }

    try {
      const bytes = await fetchVerifiedShard(descriptor, _config.sources);
      const entries = parseShardPayload(bytes);

      // The payload hash already binds these bytes; re-deriving the Merkle root
      // additionally proves the entry set matches the committed one, which is
      // what peer-computed answers will rely on later.
      if (buildShardRoot(entries) !== descriptor.merkleRoot) {
        throw new Error(`merkle root mismatch for ${descriptor.shardId}`);
      }

      const regionId = regionIdForShard(descriptor);
      await upsertLocalPois(entries.map(shardEntryToPoi), regionId);
      await recordLocalPoiCoverage(
        regionId,
        {
          south: descriptor.south,
          west: descriptor.west,
          north: descriptor.north,
          east: descriptor.east,
        },
        entries.length,
      );
      await markShardCached(descriptor, regionId);

      result.shardsFetched += 1;
      result.entries += entries.length;
    } catch (err) {
      result.failures += 1;
      logDiagnostic('shards', 'warn', 'shard unusable', {
        shardId: descriptor.shardId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.shardsFetched === 0 && result.shardsCached === 0) {
    _misses.set(key, Date.now());
  }

  return result;
}

/**
 * True when every shard intersecting the box is already imported.
 *
 * `local_poi_coverage` is keyed by region, so a viewport straddling two shard
 * cells is contained by neither row. This is the coverage question that matters
 * for a sharded source: "do I already hold all the bytes this box needs?"
 */
export async function hasShardCoverage(bounds: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<boolean> {
  if (_config.shardSets.length === 0) return false;

  const candidates = _config.shardSets.flatMap((shards) => shardsForBounds(shards, bounds));
  if (candidates.length === 0) return false;

  try {
    await ensureShardSchema();
    const cached = await readCachedShards([...new Set(candidates.map((shard) => shard.shardId))]);
    return candidates.every((descriptor) => {
      const hit = cached.get(descriptor.shardId);
      return !!hit && hit.sha256 === descriptor.sha256;
    });
  } catch {
    return false;
  }
}

/**
 * Verify a shard payload against its descriptor without importing it.
 *
 * Rejecting a payload whose entry count or Merkle root disagrees is what stops a
 * truncated shard (or a peer that dropped rows) from being indexed as complete.
 */
export function verifyShardPayload(descriptor: ShardDescriptor, bytes: Uint8Array): boolean {
  const entries = parseShardPayload(bytes);
  if (entries.length !== descriptor.poiCount) return false;
  return buildShardRoot(entries) === descriptor.merkleRoot;
}
