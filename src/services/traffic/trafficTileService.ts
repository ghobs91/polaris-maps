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
  canCallTomTom,
  isTomTomConfigured,
  noteTomTomNetworkError,
  noteTomTomRequest,
  noteTomTomResponse,
} from './tomtomAccess';
import {
  requestTile as bridgeRequestTile,
  sendTileResponse as bridgeSendTileResponse,
  onTileRequest as bridgeOnTileRequest,
  onTileResponse as bridgeOnTileResponse,
  isStarted as isSwarmStarted,
} from './hyperswarmBridge';
import { startTileServer, addTileSource, getTileServerBaseUrl } from '../../native/tileServer';
import {
  nextPeerMissStreak,
  resetPeerMissStreak,
  shouldQueryPeersForTile,
} from './trafficTilePeerPolicy';
import {
  arrayBufferToBase64,
  fileAgeSec,
  readCachedTile,
  trafficTileCacheDir,
  trafficTilePath,
  writeCachedTile,
} from './trafficTileDiskCache';

/**
 * Traffic tile manager.
 *
 * Serves TomTom flow raster tiles to the map's RasterSource through the
 * native local HTTP tile server, backed by a disk cache that is populated
 * in layers:
 *
 *   1. local disk cache (written by earlier fetches, by this service or by
 *      `tilePixelSampler` — see `trafficTileDiskCache`)
 *   2. P2P peers (tile request/response over the traffic swarm)
 *   3. TomTom API seed (only when no local/peer copy exists)
 *
 * Tiles that this node holds are also served to peers on demand.
 */

const SOURCE_ID = 'traffic';

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

// ── Peer gating ─────────────────────────────────────────────────────

/** Peers currently connected to the traffic swarm, fed by the peer-count listener. */
let connectedPeers = 0;
/** Consecutive cold-tile peer queries that came back empty. */
let peerMissStreak = 0;

/**
 * Feed the connected peer count from the traffic swarm's peer-count listener.
 * A topology change clears the miss streak: new peers are worth asking again.
 */
export function setTrafficTilePeerCount(count: number): void {
  peerMissStreak = resetPeerMissStreak(connectedPeers, count, peerMissStreak);
  connectedPeers = count;
}

/** True when a cold tile should spend its peer head start on the mesh. */
function shouldAskPeers(): boolean {
  return shouldQueryPeersForTile({
    peersConnected: connectedPeers,
    swarmStarted: isSwarmStarted(),
    missStreak: peerMissStreak,
  });
}

// ── Local HTTP tile server ──────────────────────────────────────────

/**
 * Start the native tile server and register the traffic cache directory.
 * Returns the URL template base for MapLibre (no trailing slash).
 */
export async function ensureTrafficTileServer(): Promise<string | null> {
  if (serverBaseUrl) return serverBaseUrl;
  const cacheDir = await trafficTileCacheDir();
  try {
    const port = await startTileServer({ cachePath: `${FileSystem.cacheDirectory}`, port: 0 });
    if (port > 0) {
      // Native URL(fileURLWithPath:) needs a raw path, not a file:// URI.
      await addTileSource({ id: SOURCE_ID, filePath: cacheDir.replace(/^file:\/\//, '') });
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
  if (!isSwarmStarted() || connectedPeers <= 0) return Promise.resolve(null);

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
      const cached = await readCachedTile({ z: req.z, x: req.x, y: req.y });
      const b64 = cached?.b64 ?? null;
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

/**
 * Wall-clock budget for one provider tile fetch.
 *
 * Without it a request that never settles pins the whole seeding pass: the
 * promise stays pending, `inflightSeeds` keeps the tile "in flight" for the
 * life of the process so it can never be retried, `trafficTileSeedVersion`
 * never increments, and the raster source never mounts — the layer stayed
 * blank until the app was force-quit. Measured provider TTFB is ~2–5 s, so the
 * budget is generous enough for a healthy fetch and short enough to retry.
 */
export const TILE_FETCH_TIMEOUT_MS = 6_000;

/**
 * Provider fetch concurrency per seeding pass.
 *
 * A phone viewport is ~35 tiles at every zoom level, and each one is a full
 * round-trip to the provider. Concurrency 6 meant ~6 serialized waves (~20–30 s
 * for a full viewport at measured TTFB); the centre tile is seeded separately
 * first, so this number only governs how fast the rest fills in.
 */
export const TILE_SEED_CONCURRENCY = 10;

async function seedFromTomTom(key: TileKey): Promise<string | null> {
  if (!isTomTomConfigured() || !canCallTomTom()) return null;
  noteTomTomRequest();
  const url = `${TOMTOM_FLOW_TILES_BASE_URL}/${key.z}/${key.x}/${key.y}.png?key=${encodeURIComponent(tomtomApiKey)}&tileSize=256&thickness=3`;

  // Bound the request. `AbortController` is the only way to make `fetch` give
  // up: a stalled DNS lookup or TLS handshake otherwise hangs forever, and the
  // `finally` in `ensureTrafficTile` never runs to clear the in-flight key.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TILE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    noteTomTomResponse(res.status);
    if (!res.ok) {
      if (__DEV__) console.warn(`[TrafficTiles] ${key.z}/${key.x}/${key.y} HTTP ${res.status}`);
      return null;
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TILE_BYTES) return null;
    const b64 = arrayBufferToBase64(bytes);
    await writeCachedTile(key, b64);
    return b64;
  } catch (error) {
    noteTomTomNetworkError();
    if (__DEV__) {
      console.warn(
        `[TrafficTiles] ${key.z}/${key.x}/${key.y} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Per-tile policy for a batch of seeds. */
export interface TileSeedOptions {
  /**
   * Return true to skip the TomTom seed for this tile. Used when the device
   * already holds saved flow for the tile's area in the current weekday + hour
   * bucket: the provider is not asked again, and the locally cached (or absent)
   * raster simply keeps what it has.
   */
  skipTomTom?: (key: TileKey) => boolean;
}

/**
 * Ensure a tile exists in the disk cache, resolving through
 * disk → P2P → TomTom. Returns true if the tile is cached afterwards.
 */
export async function ensureTrafficTile(
  key: TileKey,
  options: TileSeedOptions = {},
): Promise<boolean> {
  // 1. Disk
  const existing = await readCachedTile(key);
  if (existing) {
    // Refresh stale tiles in the background (fire-and-forget) so the index
    // keeps serving fresh conditions without blocking rendering.
    if (existing.ageSec > TILE_MAX_AGE_SEC) {
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
    // 2. P2P (short head start, skipped when the mesh cannot answer)
    if (shouldAskPeers()) {
      const peerB64 = await queryPeersForTile(key);
      peerMissStreak = nextPeerMissStreak(peerMissStreak, peerB64 != null);
      if (peerB64) {
        await writeCachedTile(key, peerB64);
        return true;
      }
    }

    // 3. TomTom — unless saved flow already covers this area for the bucket.
    if (options.skipTomTom?.(key)) return false;
    const b64 = await seedFromTomTom(key);
    return b64 != null;
  } finally {
    inflightSeeds.delete(cacheKey);
  }
}

async function refreshStaleTile(key: TileKey, cacheKey: string): Promise<void> {
  try {
    // The stale copy keeps rendering, so this is the one path where waiting for
    // a peer costs the user nothing visible — but it still returns null fast
    // when the mesh has nobody on it.
    const peerB64 = shouldAskPeers() ? await queryPeersForTile(key) : null;
    peerMissStreak = nextPeerMissStreak(peerMissStreak, peerB64 != null);
    const b64 = peerB64 ?? (await seedFromTomTom(key));
    if (b64) await writeCachedTile(key, b64);
  } catch {
    /* keep the stale tile */
  } finally {
    inflightSeeds.delete(cacheKey);
  }
}

/**
 * Ensure a batch of tiles (ordered by priority), with limited concurrency.
 *
 * `onTileSeeded` fires as each tile lands, so the caller can paint
 * progressively instead of waiting for the slowest tile in the viewport.
 *
 * One `__DEV__` line reports the pass total. The failure this guards against is
 * silent: a viewport that seeds 0/35 leaves `trafficTileSeedVersion` at 0, the
 * raster source unmounted and the layer blank, with nothing in the log to say
 * why. This is the signal that tells "no provider data" apart from "never
 * attempted".
 */
export async function ensureTrafficTiles(
  keys: TileKey[],
  concurrency: number = TILE_SEED_CONCURRENCY,
  onTileSeeded?: () => void,
  options: TileSeedOptions = {},
): Promise<number> {
  if (keys.length === 0) return 0;
  const queue = [...keys];
  let seeded = 0;
  const startedAt = Date.now();

  const worker = async () => {
    while (queue.length > 0) {
      const key = queue.shift()!;
      const ok = await ensureTrafficTile(key, options);
      if (ok) {
        seeded++;
        onTileSeeded?.();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  if (__DEV__) {
    console.log(
      `[TrafficTiles] seeded ${seeded}/${keys.length} at z${keys[0].z} ` +
        `in ${Date.now() - startedAt}ms (peers=${connectedPeers}, concurrency=${concurrency})`,
    );
  }
  return seeded;
}

// ── Viewport tile needs ─────────────────────────────────────────────

// Re-export the pure tile math for callers.
export { tilesForViewport, clampTrafficZoom } from './trafficTileMath';

// ── Cache maintenance ───────────────────────────────────────────────

/** Prune the disk cache to MAX_CACHED_TILES, oldest first. */
export async function pruneTileCache(): Promise<number> {
  try {
    const cacheDir = await trafficTileCacheDir();
    const entries: Array<{ key: TileKey; age: number }> = [];
    await collectTiles(cacheDir, entries, 0);
    if (entries.length <= MAX_CACHED_TILES) return 0;

    entries.sort((a, b) => b.age - a.age); // oldest (largest age) first
    const excess = entries.length - MAX_CACHED_TILES;
    let removed = 0;
    for (let i = 0; i < excess; i++) {
      try {
        await FileSystem.deleteAsync(trafficTilePath(cacheDir, entries[i].key), {
          idempotent: true,
        });
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
      out.push({ key: { z, x, y }, age: fileAgeSec(info) });
    }
    return;
  }

  for (const name of names) {
    if (Number.isNaN(Number(name))) continue; // skip non-numeric entries
    await collectTiles(`${dir}/${name}`, out, depth + 1);
  }
}
