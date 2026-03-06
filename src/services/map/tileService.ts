import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import {
  startTileServer,
  addTileSource,
  removeTileSource,
  getTileServerBaseUrl,
  getTileUrl,
  stopTileServer,
  type TileSource,
} from '../../native/tileServer';
import type { MapTile } from '../../models/tile';

const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB default

let serverPort: number | null = null;

export async function initTileService(): Promise<number> {
  const cachePath = `${FileSystem.documentDirectory}tiles/`;
  const info = await FileSystem.getInfoAsync(cachePath);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(cachePath, { intermediates: true });
  }
  serverPort = await startTileServer({ cachePath });
  return serverPort;
}

export async function registerTileSource(source: TileSource): Promise<void> {
  await addTileSource(source);
}

export async function unregisterTileSource(sourceId: string): Promise<void> {
  await removeTileSource(sourceId);
}

export function getMapStyleUrl(sourceId: string): string {
  return getTileUrl(sourceId);
}

export function getServerBaseUrl(): string {
  return getTileServerBaseUrl();
}

export async function recordTileAccess(
  tileId: string,
  sourceId: string,
  z: number,
  x: number,
  y: number,
  byteOffset: number,
  byteLength: number,
): Promise<void> {
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT OR REPLACE INTO map_tiles (id, source_id, z, x, y, byte_offset, byte_length, cached_at, last_accessed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tileId, sourceId, z, x, y, byteOffset, byteLength, now, now],
  );
}

export async function touchTile(tileId: string): Promise<void> {
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync('UPDATE map_tiles SET last_accessed = ? WHERE id = ?', [now, tileId]);
}

export async function evictLRUTiles(maxBytes: number = MAX_CACHE_BYTES): Promise<number> {
  const db = await getDatabase();
  const total = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(byte_length), 0) as total FROM map_tiles',
  );
  if (!total || total.total <= maxBytes) return 0;

  const excess = total.total - maxBytes;
  let freedBytes = 0;

  const oldest = await db.getAllAsync<Pick<MapTile, 'id' | 'byteLength' | 'filePath'>>(
    'SELECT id, byte_length as byteLength, file_path as filePath FROM map_tiles ORDER BY last_accessed ASC',
  );

  for (const tile of oldest) {
    if (freedBytes >= excess) break;
    if (tile.filePath) {
      try {
        await FileSystem.deleteAsync(tile.filePath, { idempotent: true });
      } catch {
        // file already gone
      }
    }
    await db.runAsync('DELETE FROM map_tiles WHERE id = ?', [tile.id]);
    freedBytes += tile.byteLength ?? 0;
  }

  return freedBytes;
}

export async function getCacheStats(): Promise<{
  totalBytes: number;
  tileCount: number;
}> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ totalBytes: number; tileCount: number }>(
    'SELECT COALESCE(SUM(byte_length), 0) as totalBytes, COUNT(*) as tileCount FROM map_tiles',
  );
  return result ?? { totalBytes: 0, tileCount: 0 };
}

export async function stopTileService(): Promise<void> {
  serverPort = null;
  await stopTileServer();
}
