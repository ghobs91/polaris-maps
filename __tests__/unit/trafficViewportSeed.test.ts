/**
 * Viewport seeding order.
 *
 * The raster layer only mounts once at least one tile exists, so the first
 * provider round-trip decides how long the traffic layer stays blank. The
 * centre tile is therefore seeded alone before the rest of the viewport; when
 * it was the first item in the concurrent batch it competed with
 * `TILE_SEED_CONCURRENCY - 1` other requests for the same connection budget.
 */

jest.mock('../../src/services/traffic/trafficTileService', () => ({
  initTrafficTileService: jest.fn(),
  ensureTrafficTileServer: jest.fn(async () => null),
  ensureTrafficTile: jest.fn(async () => true),
  ensureTrafficTiles: jest.fn(async (keys: unknown[]) => keys.length),
  pruneTileCache: jest.fn(async () => 0),
  setTrafficTilePeerCount: jest.fn(),
  TILE_SEED_CONCURRENCY: 10,
}));

jest.mock('../../src/services/traffic/trafficSavedFlowIndex', () => ({
  getSavedFlow: jest.fn(),
  readSavedFlow: jest.fn(async () => []),
  readSavedFlowCoverage: jest.fn(async () => new Set<string>()),
  recordSavedFlow: jest.fn(),
  savedFlowBucketForRequest: jest.fn(() => ({ dayOfWeek: 1, hour: 12 })),
}));

interface SeedHarness {
  seed: (lat: number, lng: number, zoom: number, w: number, h: number) => Promise<void>;
  ensureTile: jest.Mock;
  ensureTiles: jest.Mock;
  seedVersion: () => number;
}

/**
 * The seeding bump is throttled by module-level timer state, so each test gets
 * a fresh module graph rather than inheriting a pending throttle from the test
 * before it.
 */
function loadHarness(): SeedHarness {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tiles = require('../../src/services/traffic/trafficTileService');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const flow = require('../../src/services/traffic/trafficFlowService');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('../../src/stores/trafficStore');
  return {
    seed: flow.seedTrafficTilesForViewport,
    ensureTile: tiles.ensureTrafficTile as jest.Mock,
    ensureTiles: tiles.ensureTrafficTiles as jest.Mock,
    seedVersion: () => store.useTrafficStore.getState().trafficTileSeedVersion,
  };
}

const CONCURRENCY = 10;

beforeEach(() => {
  // Fake timers keep the seeding throttle from holding the event loop open and
  // from being carried between cases.
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('seedTrafficTilesForViewport', () => {
  it('seeds the centre tile alone before the rest of the viewport', async () => {
    const { seed, ensureTile, ensureTiles } = loadHarness();

    await seed(40.7, -74.0, 14, 402, 874);

    expect(ensureTile).toHaveBeenCalledTimes(1);
    const centerKey = ensureTile.mock.calls[0][0];

    expect(ensureTiles).toHaveBeenCalledTimes(1);
    const [remaining, concurrency] = ensureTiles.mock.calls[0];
    expect(concurrency).toBe(CONCURRENCY);
    expect(remaining).toHaveLength(34);
    expect(remaining).not.toContainEqual(centerKey);
  });

  it('seeds at the zoom MapLibre actually requests', async () => {
    const { seed, ensureTile, ensureTiles } = loadHarness();

    await seed(40.7, -74.0, 13.6, 402, 874);

    expect(ensureTile.mock.calls[0][0].z).toBe(13);
    expect(ensureTiles.mock.calls[0][0].every((k: { z: number }) => k.z === 13)).toBe(true);
  });

  it('bumps the raster seed version after the first tile so the layer can mount', async () => {
    const { seed, seedVersion } = loadHarness();

    await seed(40.7, -74.0, 14, 402, 874);

    expect(seedVersion()).toBeGreaterThan(0);
  });

  it('still seeds the rest of the viewport when the centre tile fails', async () => {
    const { seed, ensureTile, ensureTiles } = loadHarness();
    ensureTile.mockResolvedValueOnce(false);

    await seed(40.7, -74.0, 14, 402, 874);

    expect(ensureTiles).toHaveBeenCalledTimes(1);
    expect(ensureTiles.mock.calls[0][0]).toHaveLength(34);
  });
});
