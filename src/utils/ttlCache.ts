/**
 * Small in-memory cache with a time-to-live and a size bound.
 *
 * Expiry is lazy (an entry is dropped when it is next read or when the cache
 * is pruned on `set`), and `set` evicts the oldest insertions once
 * `maxEntries` is exceeded, so a long-running session cannot grow without
 * bound. Insertion order (not access order) decides eviction: entries here are
 * written once and read a handful of times, so a true LRU buys nothing.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; storedAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    const now = this.now();
    this.prune(now);
    // Re-inserting moves the key to the end so a refreshed entry is the last
    // to be evicted.
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    this.prune(this.now());
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.storedAt >= this.ttlMs) this.entries.delete(key);
    }
  }
}
