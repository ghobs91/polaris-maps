/**
 * Route flow sampling must reuse tiles the device already paid for.
 *
 * Regression: the sampler kept its decoded tiles in memory only, while the
 * raster overlay wrote the same PNGs to the on-disk tile cache. Requesting the
 * same route after a relaunch therefore re-downloaded every tile from TomTom
 * even though the bytes were sitting on disk.
 */

import { deflateSync } from 'node:zlib';

// ── Fake tile cache (shared with trafficTileService in production) ──

const mockWritten: string[] = [];
/** When set, every requested tile reports as cached with this file age. */
let mockCachedAgeSec: number | null = null;

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: async (path: string) => {
    if (!path.endsWith('.png')) return { exists: true, uri: path, isDirectory: true };
    if (mockCachedAgeSec == null) return { exists: false, uri: path, isDirectory: false };
    return {
      exists: true,
      uri: path,
      isDirectory: false,
      modificationTime: Math.floor(Date.now() / 1000) - mockCachedAgeSec,
    };
  },
  makeDirectoryAsync: async () => undefined,
  readAsStringAsync: async () => (mockCachedAgeSec == null ? '' : mockTileBase64()),
  writeAsStringAsync: async (path: string) => {
    mockWritten.push(path);
  },
}));

// Any provider interaction is a failure in the cache-hit test, so count them.
const mockProviderCalls: string[] = [];

jest.mock('../../src/services/traffic/tomtomAccess', () => ({
  isTomTomConfigured: () => true,
  canCallTomTom: () => true,
  noteTomTomRequest: () => {
    mockProviderCalls.push('request');
  },
  noteTomTomResponse: () => undefined,
  noteTomTomNetworkError: () => undefined,
}));

// ── Minimal PNG encoder (solid colour, 8-bit RGB, filter 0) ─────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** 256×256 solid-colour PNG — the tile size TomTom serves at tileSize=256. */
function solidTilePng(rgb: [number, number, number]): Buffer {
  const size = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 1 + x * 3 + 1] = rgb[1];
      raw[row + 1 + x * 3 + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** TomTom's "stopped / heavy delay" red. */
const RED_TILE = solidTilePng([220, 70, 30]);
const mockTileBase64 = () => RED_TILE.toString('base64');

// ── Route under test ───────────────────────────────────────────────

const ROUTE: [number, number][] = [
  [-71.0636, 42.3564],
  [-71.0606, 42.3571],
];

const mockFetch = jest.fn();

type Sampler = typeof import('../../src/services/traffic/tilePixelSampler');
let sampleRouteTileColors: Sampler['sampleRouteTileColors'];

beforeEach(() => {
  jest.resetModules();
  mockWritten.length = 0;
  mockProviderCalls.length = 0;
  mockCachedAgeSec = null;
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ sampleRouteTileColors } = require('../../src/services/traffic/tilePixelSampler') as Sampler);
});

describe('sampleRouteTileColors tile reuse', () => {
  it('reads a fresh cached tile instead of calling TomTom', async () => {
    mockCachedAgeSec = 60; // the overlay cached these tiles a minute ago

    const segments = await sampleRouteTileColors(ROUTE);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockProviderCalls).toEqual([]);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).toMatchObject({ source: 'tomtom', congestionRatio: 0.1 });
  });

  it('fetches a missing tile once and stores it for the next request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        RED_TILE.buffer.slice(RED_TILE.byteOffset, RED_TILE.byteOffset + RED_TILE.byteLength),
    });

    const segments = await sampleRouteTileColors(ROUTE);

    expect(mockFetch).toHaveBeenCalled();
    expect(segments.length).toBeGreaterThan(0);
    // One write per unique tile: the durable copy both surfaces read from.
    expect(mockWritten.length).toBe(new Set(mockWritten).size);
    expect(mockWritten.length).toBe(mockFetch.mock.calls.length);
    expect(mockWritten.every((path) => path.endsWith('.png'))).toBe(true);
  });

  it('re-fetches a tile that is older than the freshness window', async () => {
    mockCachedAgeSec = 60 * 60; // an hour old — no longer current traffic
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        RED_TILE.buffer.slice(RED_TILE.byteOffset, RED_TILE.byteOffset + RED_TILE.byteLength),
    });

    await sampleRouteTileColors(ROUTE);

    expect(mockFetch).toHaveBeenCalled();
  });

  it('decodes the tile only once per process for repeated requests', async () => {
    mockCachedAgeSec = 60;

    await sampleRouteTileColors(ROUTE);
    const second = await sampleRouteTileColors(ROUTE);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(second.length).toBeGreaterThan(0);
  });
});
