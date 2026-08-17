import * as FileSystem from 'expo-file-system/legacy';
import {
  MAX_TILE_BYTES,
  MAX_TILE_B64_LENGTH,
  TILE_QUERY_TIMEOUT_MS,
  TILE_MAX_AGE_SEC,
  MAX_CACHED_TILES,
  tileKeyToString,
  type TileKey,
  type WireTilePayload,
} from '../../models/trafficTile';
import { TOMTOM_FLOW_TILES_BASE_URL, tomtomApiKey } from '../../constants/config';
import {
  requestTile as bridgeRequestTile,
  sendTileResponse as bridgeSendTileResponse,
  onTileRequest as bridgeOnTileRequest,
  onTileResponse as bridgeOnTileResponse,
  isStarted as isSwarmStarted,
} from './hyperswarmBridge';
import { startTileServer, addTileSource, getTileServerBaseUrl } from '../../native/tileServer';

/**
 * Traffic tile manager.
 *
 * Serves TomTom flow raster tiles to the map's RasterSource through the
 * native local HTTP tile server, backed by a disk cache that is populated
 * in layers:
 *
 *   1. local disk cache (written by earlier fetches)
 *   2. P2P peers (tile request/response over the traffic swarm)
 *   3. TomTom API seed (only when no local/peer copy exists)
 *
 * Tiles that this node holds are also served to peers on demand.
 */

const CACHE_DIR_NAME = 'traffic-tiles';
const SOURCE_ID = 'traffic';

let cacheDir: string | null = null;
let serverBaseUrl: string | null = null;
let serverStarted = false;
let listenerWired = false;

// In-flight bookkeeping
const pendingQueries = new Map<
  string,
  { resolve: (b64: string | null) => void; timer: ReturnType<typeof setTimeout> }
>();
const inflightSeeds = new Set<string>();
let requestCounter = 0;

// ── Disk cache helpers ──────────────────────────────────────────────

function tilePath(key: TileKey): string {
  return `${cacheDir!}/${key.z}/${key.x}/${key.y}.png`;
}

async function ensureCacheDir(): Promise<void> {
  if (!cacheDir) {
    cacheDir = `${FileSystem.cacheDirectory}${CACHE_DIR_NAME}`;
  }
  const info = await FileSystem.getInfoAsync(cacheDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  }
}

async function readTileFromDisk(key: TileKey): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(tilePath(key));
    if (!info.exists) return null;
    const b64 = await FileSystem.readAsStringAsync(tilePath(key), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return b64;
  } catch {
    return null;
  }
}

async function writeTileToDisk(key: TileKey, b64: string): Promise<void> {
  await ensureCacheDir();
  const dir = `${cacheDir}/${key.z}/${key.x}`;
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(tilePath(key), b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function tileAgeSec(info: { exists?: boolean; modificationTime?: number } | null): number {
  const mtime = (info as { modificationTime?: number } | undefined)?.modificationTime;
  if (!mtime) return Infinity;
  return Math.floor(Date.now() / 1000) - mtime;
}

// ── Local HTTP tile server ──────────────────────────────────────────

/**
 * Start the native tile server and register the traffic cache directory.
 * Returns the URL template base for MapLibre (no trailing slash).
 */
export async function ensureTrafficTileServer(): Promise<string | null> {
  if (serverBaseUrl) return serverBaseUrl;
  await ensureCacheDir();
  try {
    const port = await startTileServer({ cachePath: `${FileSystem.cacheDirectory}`, port: 0 });
    if (port > 0) {
      await addTileSource({ id: SOURCE_ID, filePath: cacheDir! });
      serverBaseUrl = getTileServerBaseUrl();
      serverStarted = serverBaseUrl.length > 0;
    }
  } catch (err) {
    if (__DEV__) console.warn('[TrafficTiles] native tile server unavailable:', err);
  }
  return serverBaseUrl;
}

/** True when the raster layer can use the local server instead of TomTom. */
export function isTrafficTileServerAvailable(): boolean {
  return serverStarted && serverBaseUrl != null;
}

/** MapLibre RasterSource URL template for the local tile server. */
export function getTrafficTileUrlTemplate(): string | null {
  if (!serverBaseUrl) return null;
  return `${serverBaseUrl}/${SOURCE_ID}/{z}/{x}/{y}.png`;
}

// ── P2P query / response wiring ─────────────────────────────────────

function nextRequestId(): string {
  requestCounter = (requestCounter + 1) % 1_000_000;
  return `tile${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

/** Ask connected peers for a tile. Resolves with base64 PNG or null. */
function queryPeersForTile(
  key: TileKey,
  timeoutMs: number = TILE_QUERY_TIMEOUT_MS,
): Promise<string | null> {
  if (!isSwarmStarted()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const id = nextRequestId();
    pendingQueries.set(id, {
      resolve,
      timer: setTimeout(() => {
        const p = pendingQueries.get(id);
        if (p) {
          pendingQueries.delete(id);
          p.resolve(null);
        }
      }, timeoutMs),
    });
    bridgeRequestTile({ id, z: key.z, x: key.x, y: key.y });
  });
}

/** Wire the bridge handlers (called once). */
export function initTrafficTileService(): void {
  if (listenerWired) return;
  listenerWired = true;

  // Collect peers' tile responses
  bridgeOnTileResponse((res) => {
    const pending = pendingQueries.get(res.id);
    if (!pending) return;
    pendingQueries.delete(res.id);
    clearTimeout(pending.timer);
    if (res.tile && res.tile.b64 && res.tile.b64.length <= MAX_TILE_B64_LENGTH) {
      pending.resolve(res.tile.b64);
    } else {
      pending.resolve(null);
    }
  });

  // Serve our cached tiles to peers on demand
  bridgeOnTileRequest((req) => {
    void (async () => {
      const b64 = await readTileFromDisk({ z: req.z, x: req.x, y: req.y });
      if (b64 && b64.length <= MAX_TILE_B64_LENGTH) {
        const payload: WireTilePayload = { z: req.z, x: req.x, y: req.y, b64 };
        bridgeSendTileResponse(req.connId, req.id, payload);
      } else {
        bridgeSendTileResponse(req.connId, req.id, null);
      }
    })().catch(() => {});
  });
}

// ── Seeding (TomTom fallback) ───────────────────────────────────────

async function seedFromTomTom(key: TileKey): Promise<string | null> {
  if (!tomtomApiKey) return null;
  const url = `${TOMTOM_FLOW_TILES_BASE_URL}/${key.z}/${key.x}/${key.y}.png?key=${encodeURIComponent(tomtomApiKey)}&tileSize=256&thickness=3`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TILE_BYTES) return null;
    const b64 = arrayBufferToBase64(bytes);
    await writeTileToDisk(key, b64);
    return b64;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Ensure a tile exists in the disk cache, resolving through
 * disk → P2P → TomTom. Returns true if the tile is cached afterwards.
 */
export async function ensureTrafficTile(key: TileKey): Promise<boolean> {
  // 1. Disk
  const existing = await readTileFromDisk(key);
  if (existing) {
    // Refresh stale tiles in the background (fire-and-forget) so the index
    // keeps serving fresh conditions without blocking rendering.
    const info = await FileSystem.getInfoAsync(tilePath(key));
    if (tileAgeSec(info) > TILE_MAX_AGE_SEC) {
      const cacheKey = tileKeyToString(key);
      if (!inflightSeeds.has(cacheKey)) {
        inflightSeeds.add(cacheKey);
        void refreshStaleTile(key, cacheKey);
      }
    }
    return true;
  }

  const cacheKey = tileKeyToString(key);
  if (inflightSeeds.has(cacheKey)) return false;
  inflightSeeds.add(cacheKey);

  try {
    // 2. P2P
    const peerB64 = await queryPeersForTile(key);
    if (peerB64) {
      await writeTileToDisk(key, peerB64);
      return true;
    }

    // 3. TomTom
    const b64 = await seedFromTomTom(key);
    return b64 != null;
  } finally {
    inflightSeeds.delete(cacheKey);
  }
}

async function refreshStaleTile(key: TileKey, cacheKey: string): Promise<void> {
  try {
    const peerB64 = await queryPeersForTile(key);
    const b64 = peerB64 ?? (await seedFromTomTom(key));
    if (b64) await writeTileToDisk(key, b64);
  } catch {
    /* keep the stale tile */
  } finally {
    inflightSeeds.delete(cacheKey);
  }
}

/** Ensure a batch of tiles (ordered by priority), with limited concurrency. */
export async function ensureTrafficTiles(
  keys: TileKey[],
  concurrency: number = 6,
): Promise<number> {
  const queue = [...keys];
  let seeded = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const key = queue.shift()!;
      const ok = await ensureTrafficTile(key);
      if (ok) seeded++;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return seeded;
}

// ── Viewport tile needs ─────────────────────────────────────────────

// Re-export the pure tile math for callers.
export { tilesForViewport, clampTrafficZoom } from './trafficTileMath';

// ── Cache maintenance ───────────────────────────────────────────────

/** Prune the disk cache to MAX_CACHED_TILES, oldest first. */
export async function pruneTileCache(): Promise<number> {
  if (!cacheDir) return 0;
  try {
    const entries: Array<{ key: TileKey; age: number }> = [];
    await collectTiles(cacheDir, entries, 0);
    if (entries.length <= MAX_CACHED_TILES) return 0;

    entries.sort((a, b) => b.age - a.age); // oldest (largest age) first
    const excess = entries.length - MAX_CACHED_TILES;
    let removed = 0;
    for (let i = 0; i < excess; i++) {
      try {
        await FileSystem.deleteAsync(tilePath(entries[i].key), { idempotent: true });
        removed++;
      } catch {
        /* ignore */
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

async function collectTiles(
  dir: string,
  out: Array<{ key: TileKey; age: number }>,
  depth: number,
): Promise<void> {
  if (depth > 3) return;
  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);

  if (depth === 3) {
    // `dir` is .../z/x — list *.png tile files
    const parts = dir.split('/');
    const x = Number(parts[parts.length - 1]);
    const z = Number(parts[parts.length - 2]);
    if (Number.isNaN(x) || Number.isNaN(z)) return;
    for (const f of names) {
      if (!f.endsWith('.png')) continue;
      const y = Number(f.replace('.png', ''));
      if (Number.isNaN(y)) continue;
      const info = await FileSystem.getInfoAsync(`${dir}/${f}`);
      out.push({ key: { z, x, y }, age: tileAgeSec(info) });
    }
    return;
  }

  for (const name of names) {
    if (Number.isNaN(Number(name))) continue; // skip non-numeric entries
    await collectTiles(`${dir}/${name}`, out, depth + 1);
  }
}
