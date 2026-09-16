/**
 * searchCache module tests: TTL, LRU eviction, negative caching, in-flight
 * dedupe, and bbox-scoped invalidation.
 */

import {
  boundsKey,
  cacheGet,
  cacheSet,
  cachedFetch,
  clearSearchCache,
  invalidateSearchCacheForBbox,
  quantizeBounds,
  searchCacheSize,
} from '../../src/services/search/searchCache';

describe('searchCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearSearchCache();
  });

  afterEach(() => {
    jest.useRealTimers();
    clearSearchCache();
  });

  it('stores and retrieves values', () => {
    cacheSet('k', [1, 2, 3]);
    expect(cacheGet<number[]>('k')).toEqual([1, 2, 3]);
  });

  it('expires entries after the TTL', () => {
    cacheSet('k', 'value', { ttlMs: 1000 });
    jest.advanceTimersByTime(999);
    expect(cacheGet('k')).toBe('value');
    jest.advanceTimersByTime(2);
    expect(cacheGet('k')).toBeUndefined();
  });

  it('runs the fetch once and serves the cached value afterwards', async () => {
    const fn = jest.fn().mockResolvedValue(['a']);
    const first = await cachedFetch('key', fn);
    const second = await cachedFetch('key', fn);

    expect(first).toEqual(['a']);
    expect(second).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('negative-caches empty results with the shorter TTL', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    await cachedFetch('empty', fn);

    jest.advanceTimersByTime(59_000);
    await cachedFetch('empty', fn);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    await cachedFetch('empty', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent identical fetches', async () => {
    let resolve!: (value: string[]) => void;
    const fn = jest.fn(
      () =>
        new Promise<string[]>((res) => {
          resolve = res;
        }),
    );

    const a = cachedFetch('key', fn);
    const b = cachedFetch('key', fn);
    expect(fn).toHaveBeenCalledTimes(1);

    resolve(['shared']);
    await expect(a).resolves.toEqual(['shared']);
    await expect(b).resolves.toEqual(['shared']);
  });

  it('does not cache rejected fetches', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(['ok']);

    await expect(cachedFetch('key', fn)).rejects.toThrow('network');
    await expect(cachedFetch('key', fn)).resolves.toEqual(['ok']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('evicts the least-recently-used entry beyond the limit', () => {
    for (let i = 0; i < 101; i++) {
      cacheSet(`k${i}`, i);
    }
    expect(searchCacheSize()).toBe(100);
    expect(cacheGet('k0')).toBeUndefined();
    expect(cacheGet('k100')).toBe(100);

    // Touching k1 makes k2 the oldest; the next insert evicts k2.
    expect(cacheGet('k1')).toBe(1);
    cacheSet('k101', 101);
    expect(cacheGet('k2')).toBeUndefined();
    expect(cacheGet('k1')).toBe(1);
  });

  it('invalidates only entries whose bounds overlap', () => {
    cacheSet('a', 'a', { bounds: { south: 40, north: 41, west: -74, east: -73 } });
    cacheSet('b', 'b', { bounds: { south: 34, north: 35, west: -119, east: -118 } });

    const removed = invalidateSearchCacheForBbox({
      south: 40.5,
      north: 40.6,
      west: -73.5,
      east: -73.4,
    });

    expect(removed).toBe(1);
    expect(cacheGet('a')).toBeUndefined();
    expect(cacheGet('b')).toBe('b');
  });

  it('quantizes bounds for stable cache keys', () => {
    const a = boundsKey({ south: 40.7481, north: 40.7499, west: -73.9851, east: -73.984 });
    const b = boundsKey({ south: 40.7482, north: 40.7498, west: -73.9852, east: -73.9839 });
    expect(a).toBe(b);
    expect(quantizeBounds({ south: 40.7481, north: 41, west: -74, east: -73 })).toEqual({
      south: 40.75,
      north: 41,
      west: -74,
      east: -73,
    });
  });
});
