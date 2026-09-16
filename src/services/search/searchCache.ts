/**
 * In-memory cache for network-augmented search sources.
 *
 * Search results from Photon, Overpass, Nominatim, and Overture are keyed by
 * query + quantized viewport and reused for a short TTL, so repeated queries
 * (backspacing, "search this area", multiple consumers) do not re-hit the
 * network. Empty results get a shorter negative TTL to avoid repeating slow
 * fruitless queries. Concurrent identical lookups share one in-flight promise.
 *
 * The local SQLite phase is intentionally never cached — it is milliseconds
 * and must reflect fresh local writes.
 */

export interface CacheBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Maximum cached entries before LRU eviction. */
const MAX_ENTRIES = 100;

/** TTL for non-empty results. */
export const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

/** TTL for empty results (negative cache). */
export const SEARCH_CACHE_NEGATIVE_TTL_MS = 60 * 1000;

/** Viewport quantization for cache keys (~550 m at the equator). */
const BBOX_BUCKET_DEG = 0.005;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  bounds?: CacheBounds;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/** Snap bounds to bucket boundaries so near-identical viewports share a key. */
export function quantizeBounds(bounds: CacheBounds): CacheBounds {
  const q = (n: number) => Math.round(n / BBOX_BUCKET_DEG) * BBOX_BUCKET_DEG;
  return {
    south: q(bounds.south),
    north: q(bounds.north),
    west: q(bounds.west),
    east: q(bounds.east),
  };
}

/** Build a stable cache key from source tag, query, and options. */
export function cacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts.map((part) => (part === null || part === undefined ? '' : String(part))).join('|');
}

/** Quantized bbox string for use inside cache keys. */
export function boundsKey(bounds: CacheBounds): string {
  const b = quantizeBounds(bounds);
  return `${b.south},${b.west},${b.north},${b.east}`;
}

function getEntry<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  // Refresh LRU position.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value as T;
}

export function cacheGet<T>(key: string): T | undefined {
  return getEntry<T>(key);
}

export function cacheSet<T>(
  key: string,
  value: T,
  opts?: { bounds?: CacheBounds; ttlMs?: number },
): void {
  if (entries.has(key)) entries.delete(key);
  entries.set(key, {
    value,
    expiresAt: Date.now() + (opts?.ttlMs ?? SEARCH_CACHE_TTL_MS),
    bounds: opts?.bounds,
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/**
 * Return a cached value, or run `fn` once and cache its result. Concurrent
 * callers for the same key await the same in-flight promise.
 */
export function cachedFetch<T>(
  key: string,
  fn: () => Promise<T>,
  opts?: { bounds?: CacheBounds; ttlMs?: number },
): Promise<T> {
  const cached = getEntry<T>(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn()
    .then((value) => {
      const isEmpty = Array.isArray(value) && value.length === 0;
      cacheSet(key, value, {
        bounds: opts?.bounds,
        ttlMs: isEmpty ? SEARCH_CACHE_NEGATIVE_TTL_MS : opts?.ttlMs,
      });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function boundsOverlap(a: CacheBounds, b: CacheBounds): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/**
 * Drop cached entries whose tagged bounds overlap the given bounds. Called
 * when local data changes (Overture upserts, region import/removal) so stale
 * network results are not served over fresh local data.
 */
export function invalidateSearchCacheForBbox(bounds: CacheBounds): number {
  let removed = 0;
  for (const [key, entry] of entries) {
    if (entry.bounds && boundsOverlap(entry.bounds, bounds)) {
      entries.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Drop every cached entry and in-flight promise (tests, sign-out). */
export function clearSearchCache(): void {
  entries.clear();
  inFlight.clear();
}

/** Current number of cached entries (tests/diagnostics). */
export function searchCacheSize(): number {
  return entries.size;
}
