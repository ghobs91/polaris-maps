import {
  __resetTrafficSeedCacheForTests,
  readCachedSeeds,
  seedCellForSegment,
  seedThroughCache,
  SEED_CACHE_MAX_CELLS,
  SEED_CACHE_NEGATIVE_TTL_MS,
  SEED_CACHE_TTL_MS,
  trafficSeedCacheSize,
  writeCachedSeeds,
} from '../../src/services/traffic/trafficSeedCache';
import { encode as geohashEncode } from '../../src/utils/geohash';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

const NOW = 1_800_000_000_000;
const CELL = geohashEncode(40.7, -74.0, 5);
const OTHER_CELL = geohashEncode(40.8, -74.1, 5);

function segmentAt(cell: string, id = cell, ratio = 0.5): NormalizedTrafficSegment {
  const decoded = cell === OTHER_CELL ? { lat: 40.8, lng: -74.1 } : { lat: 40.7, lng: -74.0 };
  return {
    id,
    coordinates: [[decoded.lng, decoded.lat]],
    currentSpeedMph: 30,
    freeFlowSpeedMph: 60,
    congestionRatio: ratio,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: Math.floor(NOW / 1000),
  };
}

describe('seedCellForSegment', () => {
  it('maps a segment to the geohash5 cell of its first coordinate', () => {
    expect(seedCellForSegment(segmentAt(CELL))).toBe(CELL);
  });

  it('returns null for empty geometry', () => {
    expect(seedCellForSegment({ ...segmentAt(CELL), coordinates: [] })).toBeNull();
  });
});

describe('seedThroughCache', () => {
  beforeEach(() => __resetTrafficSeedCacheForTests());

  it('calls the provider only for cells with no cached answer', async () => {
    const fetchSegments = jest.fn(async (missing: string[]) =>
      missing.map((cell) => segmentAt(cell)),
    );

    const first = await seedThroughCache([CELL, OTHER_CELL], fetchSegments, { now: NOW });
    expect(first).toHaveLength(2);
    expect(fetchSegments).toHaveBeenCalledWith([CELL, OTHER_CELL]);

    // Inside the freshness window the provider is not asked again.
    const second = await seedThroughCache([CELL, OTHER_CELL], fetchSegments, { now: NOW + 60_000 });
    expect(second).toHaveLength(2);
    expect(fetchSegments).toHaveBeenCalledTimes(1);

    // Only the expired cell is re-fetched after the TTL.
    await seedThroughCache([CELL, OTHER_CELL], fetchSegments, { now: NOW + SEED_CACHE_TTL_MS + 1 });
    expect(fetchSegments).toHaveBeenCalledTimes(2);
  });

  it('negative-caches cells the provider had no data for', async () => {
    const empty = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    await seedThroughCache([CELL], empty, { now: NOW });
    expect(empty).toHaveBeenCalledTimes(1);

    // Within the shorter negative window the provider is not asked again.
    await seedThroughCache([CELL], empty, { now: NOW + SEED_CACHE_NEGATIVE_TTL_MS - 1 });
    expect(empty).toHaveBeenCalledTimes(1);

    await seedThroughCache([CELL], empty, { now: NOW + SEED_CACHE_NEGATIVE_TTL_MS + 1 });
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('retries immediately when negative caching is disabled', async () => {
    const empty = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    await seedThroughCache([CELL], empty, { now: NOW, negativeTtlMs: 0 });
    await seedThroughCache([CELL], empty, { now: NOW + 1, negativeTtlMs: 0 });
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('does not call the provider when no cells are requested', async () => {
    const fetchSegments = jest.fn(async () => [] as NormalizedTrafficSegment[]);
    await expect(seedThroughCache([], fetchSegments, { now: NOW })).resolves.toEqual([]);
    expect(fetchSegments).not.toHaveBeenCalled();
  });

  it('propagates provider errors without caching a failure as empty', async () => {
    const failing = jest.fn(async () => {
      throw new Error('provider down');
    });
    await expect(seedThroughCache([CELL], failing, { now: NOW })).rejects.toThrow('provider down');

    const retry = jest.fn(async () => [segmentAt(CELL)]);
    await expect(seedThroughCache([CELL], retry, { now: NOW + 1 })).resolves.toHaveLength(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated cells in one request', async () => {
    const fetchSegments = jest.fn(async (missing: string[]) =>
      missing.map((cell) => segmentAt(cell)),
    );
    await seedThroughCache([CELL, CELL], fetchSegments, { now: NOW });
    expect(fetchSegments).toHaveBeenCalledWith([CELL]);
  });
});

describe('readCachedSeeds / writeCachedSeeds', () => {
  beforeEach(() => __resetTrafficSeedCacheForTests());

  it('drops expired entries', () => {
    writeCachedSeeds([CELL], [segmentAt(CELL)], { now: NOW });
    expect(readCachedSeeds([CELL], NOW + 1).missing).toEqual([]);

    const afterTtl = readCachedSeeds([CELL], NOW + SEED_CACHE_TTL_MS + 1);
    expect(afterTtl.segments).toEqual([]);
    expect(afterTtl.missing).toEqual([CELL]);
  });

  it('bounds the number of cached cells', () => {
    const cells = new Set<string>();
    for (let lat = -80; lat <= 80 && cells.size < SEED_CACHE_MAX_CELLS + 20; lat += 0.5) {
      for (let lng = -170; lng <= 170 && cells.size < SEED_CACHE_MAX_CELLS + 20; lng += 0.5) {
        cells.add(geohashEncode(lat, lng, 5));
      }
    }

    writeCachedSeeds(Array.from(cells), [], { now: NOW });
    expect(cells.size).toBeGreaterThan(SEED_CACHE_MAX_CELLS);
    expect(trafficSeedCacheSize(NOW)).toBeLessThanOrEqual(SEED_CACHE_MAX_CELLS);
  });
});
