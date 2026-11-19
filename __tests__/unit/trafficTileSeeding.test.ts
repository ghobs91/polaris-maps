/**
 * Traffic tile seeding: bounded provider requests and bounded concurrency.
 *
 * These two properties are what decide whether the raster layer paints or
 * hangs. Before them a single stalled provider request left `ensureTrafficTile`
 * pending forever: the tile stayed in `inflightSeeds` for the life of the
 * process, so it was never retried and `trafficTileSeedVersion` never
 * incremented — the layer stayed blank until the app was force-quit.
 */

const mockFetch = jest.fn();

jest.mock('../../src/constants/config', () => ({
  tomtomApiKey: 'test-key',
  TOMTOM_FLOW_TILES_BASE_URL: 'https://api.tomtom.com/traffic/map/4/tile/flow/absolute',
}));

jest.mock('../../src/services/traffic/tomtomAccess', () => ({
  isTomTomConfigured: () => true,
  canCallTomTom: () => true,
  noteTomTomRequest: jest.fn(),
  noteTomTomResponse: jest.fn(),
  noteTomTomNetworkError: jest.fn(),
}));

jest.mock('../../src/services/traffic/hyperswarmBridge', () => ({
  requestTile: jest.fn(),
  sendTileResponse: jest.fn(),
  onTileRequest: jest.fn(),
  onTileResponse: jest.fn(),
  isStarted: () => false,
}));

jest.mock('../../src/native/tileServer', () => ({
  startTileServer: jest.fn(async () => 0),
  addTileSource: jest.fn(async () => undefined),
  getTileServerBaseUrl: () => '',
}));

// The durable disk cache is exercised by its own suite; here it is just the
// thing that reports "no local copy", so every seed has to reach the provider.
jest.mock('../../src/services/traffic/trafficTileDiskCache', () => ({
  readCachedTile: jest.fn(async () => null),
  writeCachedTile: jest.fn(async () => undefined),
  trafficTileCacheDir: jest.fn(async () => '/tmp/traffic-tiles'),
  trafficTilePath: jest.fn(() => '/tmp/traffic-tiles/0/0/0.png'),
  fileAgeSec: jest.fn(() => 0),
  readFreshCachedTile: jest.fn(async () => null),
  arrayBufferToBase64: jest.fn(() => 'AAAA'),
  base64ToArrayBuffer: jest.fn(() => new ArrayBuffer(0)),
  __resetTileDiskCacheForTests: jest.fn(),
}));

import {
  ensureTrafficTile,
  ensureTrafficTiles,
  TILE_FETCH_TIMEOUT_MS,
  TILE_SEED_CONCURRENCY,
} from '../../src/services/traffic/trafficTileService';
import { writeCachedTile, readCachedTile } from '../../src/services/traffic/trafficTileDiskCache';

beforeEach(() => {
  mockFetch.mockReset();
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
  (readCachedTile as jest.Mock).mockClear();
  (writeCachedTile as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

function okResponse(bytes = 64) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  };
}

describe('provider request budget', () => {
  it('gives up on a stalled fetch and lets the tile be retried', async () => {
    jest.useFakeTimers();
    mockFetch.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );

    const key = { z: 14, x: 100, y: 200 };
    const pending = ensureTrafficTile(key);
    await jest.advanceTimersByTimeAsync(TILE_FETCH_TIMEOUT_MS + 10);
    const seeded = await pending;

    expect(seeded).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The in-flight marker must be cleared on timeout, otherwise this second
    // call short-circuits and the tile can never be fetched again.
    mockFetch.mockResolvedValueOnce(okResponse());
    await expect(ensureTrafficTile(key)).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('passes an abort signal so the request can actually be cancelled', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await ensureTrafficTile({ z: 14, x: 1, y: 2 });

    const init = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });

  it('caches the tile bytes on a successful seed', async () => {
    mockFetch.mockResolvedValue(okResponse());

    await expect(ensureTrafficTile({ z: 14, x: 3, y: 4 })).resolves.toBe(true);
    expect(writeCachedTile).toHaveBeenCalledWith({ z: 14, x: 3, y: 4 }, 'AAAA');
  });

  it('returns false without fetching when the provider has no data', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(ensureTrafficTile({ z: 14, x: 5, y: 6 })).resolves.toBe(false);
    expect(writeCachedTile).not.toHaveBeenCalled();
  });
});

describe('seeding concurrency', () => {
  it('runs a full viewport through at most TILE_SEED_CONCURRENCY requests', async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return okResponse();
    });

    // A phone viewport is ~35 tiles at any zoom level.
    const keys = Array.from({ length: 35 }, (_, i) => ({ z: 14, x: 4000 + i, y: 5000 }));

    await expect(ensureTrafficTiles(keys)).resolves.toBe(35);

    expect(peak).toBeLessThanOrEqual(TILE_SEED_CONCURRENCY);
    expect(mockFetch).toHaveBeenCalledTimes(35);
  });

  it('reports each tile as it lands so the layer can paint progressively', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const onTileSeeded = jest.fn();

    const keys = Array.from({ length: 5 }, (_, i) => ({ z: 14, x: 900 + i, y: 900 }));
    await ensureTrafficTiles(keys, 2, onTileSeeded);

    expect(onTileSeeded).toHaveBeenCalledTimes(5);
  });
});
