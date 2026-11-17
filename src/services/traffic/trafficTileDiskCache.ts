import * as FileSystem from 'expo-file-system/legacy';
import type { TileKey } from '../../models/trafficTile';

/**
 * On-disk cache for TomTom flow raster tiles.
 *
 * Two surfaces need the same tile bytes:
 *
 *   - `trafficTileService` serves them to the map's RasterSource through the
 *     native tile server (disk → P2P peers → TomTom seed);
 *   - `tilePixelSampler` decodes them to read the flow colour along a route.
 *
 * They used to keep separate caches, so a directions request downloaded the
 * same z/x/y PNGs twice in one session — and because only this module's copy
 * lives on disk, every one of them was downloaded again after a relaunch. The
 * directory is therefore the shared, durable copy: whoever pays for a tile
 * writes it here, and any later request inside the freshness window reads it
 * without touching the provider.
 */

const CACHE_DIR_NAME = 'traffic-tiles';

let cacheDir: string | null = null;

/** Absolute path of the tile cache directory, created on first use. */
export async function trafficTileCacheDir(): Promise<string> {
  if (!cacheDir) cacheDir = `${FileSystem.cacheDirectory}${CACHE_DIR_NAME}`;
  const info = await FileSystem.getInfoAsync(cacheDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  }
  return cacheDir;
}

/** Path of one tile's cached PNG under the cache directory. */
export function trafficTilePath(dir: string, key: TileKey): string {
  return `${dir}/${key.z}/${key.x}/${key.y}.png`;
}

/** A cached tile plus the age of its file (from the filesystem mtime). */
export interface CachedTile {
  /** Base64 PNG bytes. */
  b64: string;
  /** Seconds since the tile file was written; `Infinity` when unknown. */
  ageSec: number;
}

/** Age of a file in seconds; `Infinity` when the mtime is unavailable. */
export function fileAgeSec(info: { exists?: boolean; modificationTime?: number } | null): number {
  const mtime = (info as { modificationTime?: number } | undefined)?.modificationTime;
  if (!mtime) return Infinity;
  return Math.floor(Date.now() / 1000) - mtime;
}

/** Read a cached tile and its age. Null when absent or unreadable. */
export async function readCachedTile(key: TileKey): Promise<CachedTile | null> {
  try {
    const dir = await trafficTileCacheDir();
    const path = trafficTilePath(dir, key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { b64, ageSec: fileAgeSec(info) };
  } catch {
    return null;
  }
}

/**
 * Read a cached tile only when it is younger than `maxAgeSec`.
 *
 * Stale copies are deliberately not returned: traffic colours are only
 * meaningful for a short window, so an old file must be treated as a miss
 * (the caller re-seeds it) instead of silently answering with yesterday's jam.
 */
export async function readFreshCachedTile(key: TileKey, maxAgeSec: number): Promise<string | null> {
  const cached = await readCachedTile(key);
  if (!cached) return null;
  if (cached.ageSec > maxAgeSec) return null;
  return cached.b64;
}

/** Store a tile's base64 PNG bytes for both surfaces. */
export async function writeCachedTile(key: TileKey, b64: string): Promise<void> {
  const dir = await trafficTileCacheDir();
  const tileDir = `${dir}/${key.z}/${key.x}`;
  const info = await FileSystem.getInfoAsync(tileDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true });
  }
  await FileSystem.writeAsStringAsync(trafficTilePath(dir, key), b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/** Base64 → ArrayBuffer (tile payloads arrive and persist as base64). */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer → base64, chunked so a 256×256 PNG cannot blow the call stack. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Test-only: forget the resolved cache directory. */
export function __resetTileDiskCacheForTests(): void {
  cacheDir = null;
}
