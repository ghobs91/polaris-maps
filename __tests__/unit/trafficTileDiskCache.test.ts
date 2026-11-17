/**
 * Shared on-disk tile cache — the copy both the raster overlay and the route
 * sampler read from, and the only tile data that survives a relaunch.
 */

const mockFiles = new Map<string, { b64: string; modificationTime: number }>();
const mockDirs = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: async (path: string) => {
    const file = mockFiles.get(path);
    if (file) {
      return {
        exists: true,
        uri: path,
        isDirectory: false,
        modificationTime: file.modificationTime,
      };
    }
    return { exists: mockDirs.has(path), uri: path, isDirectory: mockDirs.has(path) };
  },
  makeDirectoryAsync: async (path: string) => {
    mockDirs.add(path);
  },
  readAsStringAsync: async (path: string) => {
    const file = mockFiles.get(path);
    if (!file) throw new Error(`ENOENT ${path}`);
    return file.b64;
  },
  writeAsStringAsync: async (path: string, value: string) => {
    mockFiles.set(path, { b64: value, modificationTime: Math.floor(Date.now() / 1000) });
  },
}));

import {
  __resetTileDiskCacheForTests,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  fileAgeSec,
  readCachedTile,
  readFreshCachedTile,
  trafficTileCacheDir,
  writeCachedTile,
} from '../../src/services/traffic/trafficTileDiskCache';

const KEY = { z: 14, x: 4823, y: 6160 };
const TILE_PATH = 'file:///cache/traffic-tiles/14/4823/6160.png';

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  __resetTileDiskCacheForTests();
});

describe('trafficTileDiskCache', () => {
  it('writes a tile to the shared directory and reads it back', async () => {
    await writeCachedTile(KEY, 'cG5n');

    expect(mockFiles.get(TILE_PATH)?.b64).toBe('cG5n');
    const cached = await readCachedTile(KEY);
    expect(cached?.b64).toBe('cG5n');
    expect(cached?.ageSec).toBeLessThan(60);
  });

  it('serves a fresh tile without any provider involvement', async () => {
    await writeCachedTile(KEY, 'cG5n');
    await expect(readFreshCachedTile(KEY, 15 * 60)).resolves.toBe('cG5n');
  });

  it('refuses a stale tile so the caller re-seeds it', async () => {
    mockFiles.set(TILE_PATH, {
      b64: 'cG5n',
      modificationTime: Math.floor(Date.now() / 1000) - 20 * 60,
    });

    await expect(readFreshCachedTile(KEY, 15 * 60)).resolves.toBeNull();
    // The bytes are still readable — the overlay keeps painting stale tiles.
    await expect(readCachedTile(KEY)).resolves.toMatchObject({ b64: 'cG5n' });
  });

  it('treats a tile with no usable mtime as stale', async () => {
    mockFiles.set(TILE_PATH, { b64: 'cG5n', modificationTime: 0 });
    expect(fileAgeSec({ exists: true })).toBe(Infinity);
    await expect(readFreshCachedTile(KEY, 15 * 60)).resolves.toBeNull();
  });

  it('returns null for a tile that was never cached', async () => {
    await expect(readCachedTile(KEY)).resolves.toBeNull();
    await expect(readFreshCachedTile(KEY, 15 * 60)).resolves.toBeNull();
  });

  it('resolves the cache directory under the app cache directory', async () => {
    await expect(trafficTileCacheDir()).resolves.toBe('file:///cache/traffic-tiles');
    expect(mockDirs.has('file:///cache/traffic-tiles')).toBe(true);
  });

  it('round-trips base64 through an ArrayBuffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const b64 = arrayBufferToBase64(bytes.buffer);
    const back = new Uint8Array(base64ToArrayBuffer(b64));
    expect(Array.from(back)).toEqual([0, 1, 2, 250, 251, 255]);
  });

  it('round-trips a payload larger than one conversion chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    const back = new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes.buffer)));
    expect(back.length).toBe(bytes.length);
    expect(back[0]).toBe(bytes[0]);
    expect(back[99_999]).toBe(bytes[99_999]);
  });
});
