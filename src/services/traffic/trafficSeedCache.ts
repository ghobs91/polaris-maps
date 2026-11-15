import type { NormalizedTrafficSegment } from '../../models/traffic';
import { encode as geohashEncode } from '../../utils/geohash';

/**
 * Short-lived cache for upstream bootstrap data (TomTom cold-start seeds and
 * free open feeds), keyed by geohash5 cell.
 *
 * The weekly condition index (`trafficHistoryService`) is the *on-device flow
 * history*: rows there are EMA profiles per cell × day-of-week × half-hour and
 * are only meaningful when they come from probes. Writing licensed upstream
 * seeds into that table made the on-device history both wrongly attributed
 * (a TomTom observation replayed from `local-fresh` looked like device data)
 * and needlessly granular (a single cold-start seed created a permanent
 * weekly row). Upstream data is therefore cached here instead: bounded, in
 * memory, and discarded after the same freshness window the index used to
 * apply (`CURRENT_FRESH_SEC`), so repeated refreshes still do not re-hit the
 * provider.
 *
 * A cell that the provider could not answer is cached as an empty entry for a
 * shorter window (negative cache) — otherwise the unresolved tail of a
 * viewport is re-queried on every refresh, which is what made the bridge look
 * like it was consulted first for everything.
 */

/** Positive freshness window — matches the old `CURRENT_FRESH_SEC` replay. */
export const SEED_CACHE_TTL_MS = 15 * 60 * 1000;
/** A provider that had no data for a cell is not asked again this soon. */
export const SEED_CACHE_NEGATIVE_TTL_MS = 5 * 60 * 1000;
/** Bound on cached cells (≈1 km² each at geohash5 resolution). */
export const SEED_CACHE_MAX_CELLS = 1024;

interface SeedEntry {
  segments: NormalizedTrafficSegment[];
  expiresAt: number;
}

export interface SeedCacheOptions {
  /** Clock override (tests). */
  now?: number;
  /**
   * How long "the provider had no data for this cell" is remembered.
   * `0` disables negative caching so the provider is retried next time —
   * used for free open feeds, where a transient outage must not hand the
   * cell to the paid cold-start bridge for five minutes.
   */
  negativeTtlMs?: number;
}

const cache = new Map<string, SeedEntry>();

/** geohash5 cell of a segment's first coordinate, or null for empty geometry. */
export function seedCellForSegment(seg: NormalizedTrafficSegment): string | null {
  const first = seg.coordinates[0];
  if (!first) return null;
  return geohashEncode(first[1], first[0], 5);
}

function pruneExpired(now: number): void {
  for (const [cell, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cell);
  }
}

/**
 * Read cached seeds for the requested cells.
 *
 * Returns the segments that are still fresh plus the cells that need a
 * provider call. Expired entries are dropped so they cannot be served again.
 */
export function readCachedSeeds(
  cells: readonly string[],
  now: number = Date.now(),
): { segments: NormalizedTrafficSegment[]; missing: string[] } {
  const segments: NormalizedTrafficSegment[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const cell of cells) {
    if (seen.has(cell)) continue;
    seen.add(cell);
    const entry = cache.get(cell);
    if (entry && entry.expiresAt > now) {
      segments.push(...entry.segments);
    } else {
      if (entry) cache.delete(cell);
      missing.push(cell);
    }
  }

  return { segments, missing };
}

/** Store the provider's answer for every requested cell (empty = negative). */
export function writeCachedSeeds(
  cells: readonly string[],
  segments: NormalizedTrafficSegment[],
  options: SeedCacheOptions = {},
): void {
  const now = options.now ?? Date.now();
  const negativeTtlMs = options.negativeTtlMs ?? SEED_CACHE_NEGATIVE_TTL_MS;
  const byCell = new Map<string, NormalizedTrafficSegment[]>();
  for (const seg of segments) {
    const cell = seedCellForSegment(seg);
    if (!cell) continue;
    const list = byCell.get(cell);
    if (list) {
      list.push(seg);
    } else {
      byCell.set(cell, [seg]);
    }
  }

  for (const cell of new Set(cells)) {
    const cellSegments = byCell.get(cell) ?? [];
    const ttl = cellSegments.length > 0 ? SEED_CACHE_TTL_MS : negativeTtlMs;
    // Re-inserting moves the entry to the end, so the map's key order stays a
    // reasonable eviction order for the size cap below.
    cache.delete(cell);
    if (ttl > 0) {
      cache.set(cell, { segments: cellSegments, expiresAt: now + ttl });
    }
  }

  pruneExpired(now);
  while (cache.size > SEED_CACHE_MAX_CELLS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Resolve upstream seed segments for the given cells, calling the provider
 * only for cells with no fresh cached answer.
 */
export async function seedThroughCache(
  cells: readonly string[],
  fetchSegments: (missing: string[]) => Promise<NormalizedTrafficSegment[]>,
  options: SeedCacheOptions = {},
): Promise<NormalizedTrafficSegment[]> {
  const now = options.now ?? Date.now();
  const cached = readCachedSeeds(cells, now);
  if (cached.missing.length === 0) return cached.segments;

  const fetched = await fetchSegments(cached.missing);
  writeCachedSeeds(cached.missing, fetched, { ...options, now });
  return [...cached.segments, ...fetched];
}

/** Number of live (non-expired) cells in the cache — diagnostics only. */
export function trafficSeedCacheSize(now: number = Date.now()): number {
  pruneExpired(now);
  return cache.size;
}

/** Test-only: empty the cache. */
export function __resetTrafficSeedCacheForTests(): void {
  cache.clear();
}
