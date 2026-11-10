import {
  getTilesForBounds,
  latLngToTile,
  OPENFREEMAP_MAX_DOWNLOAD_BYTES,
  OPENFREEMAP_MAX_PARALLEL_DOWNLOADS,
  planOfflineTileDownload,
  OPENFREEMAP_MAX_TILES_PER_DOWNLOAD,
} from '../../src/services/regions/tileDownloadPlan';

const SF = { minLat: 37.2, maxLat: 38.0, minLng: -122.6, maxLng: -121.5 };

describe('OpenFreeMap offline policy constants', () => {
  it('matches the published offline-download limits', () => {
    expect(OPENFREEMAP_MAX_TILES_PER_DOWNLOAD).toBe(3_000);
    expect(OPENFREEMAP_MAX_DOWNLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(OPENFREEMAP_MAX_PARALLEL_DOWNLOADS).toBe(4);
  });
});

describe('planOfflineTileDownload', () => {
  it('keeps a metro region at full detail under the tile budget', () => {
    const plan = planOfflineTileDownload(SF);

    expect(plan.maxZoom).toBe(12);
    expect(plan.reduced).toBe(false);
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.tiles.length).toBeLessThanOrEqual(OPENFREEMAP_MAX_TILES_PER_DOWNLOAD);
    expect(new Set(plan.tiles.map((t) => t.z))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );
  });

  it('lowers max zoom for an oversized region instead of exceeding the budget', () => {
    const continent = { minLat: 24, maxLat: 50, minLng: -125, maxLng: -66 };
    const plan = planOfflineTileDownload(continent);

    expect(plan.reduced).toBe(true);
    expect(plan.maxZoom).toBeLessThan(12);
    expect(plan.tiles.length).toBeLessThanOrEqual(OPENFREEMAP_MAX_TILES_PER_DOWNLOAD);
  });

  it('throws when even the minimum zoom cannot fit the budget', () => {
    const world = { minLat: -85, maxLat: 85, minLng: -180, maxLng: 180 };
    expect(() => planOfflineTileDownload(world, { maxTiles: 0 })).toThrow(/too large/i);
  });

  it('respects custom zoom bounds', () => {
    const plan = planOfflineTileDownload(SF, { minZoom: 8, preferredMaxZoom: 12 });
    expect(Math.min(...plan.tiles.map((t) => t.z))).toBe(8);
    expect(Math.max(...plan.tiles.map((t) => t.z))).toBe(12);
  });
});

describe('getTilesForBounds', () => {
  it('includes every zoom from min to max and grows with detail', () => {
    const tiles = getTilesForBounds(SF, 0, 3);
    expect(tiles.filter((t) => t.z === 0)).toHaveLength(1);

    const counts = [0, 1, 2, 3].map((z) => tiles.filter((t) => t.z === z).length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }

    for (const tile of tiles) {
      const max = Math.pow(2, tile.z);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(max);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(max);
    }
  });

  it('clamps tile coordinates at the poles', () => {
    const { x, y } = latLngToTile(90, 0, 4);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(16);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(16);
  });
});
