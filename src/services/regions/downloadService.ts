import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { downloadFromPeers, seedRegion, unseedRegion } from '../sync/hyperdriveBridge';
import { OPENFREEMAP_TILEJSON_URL } from '../../constants/config';
import type { Region } from '../../models/region';

/** Cached OpenFreeMap tile URL template resolved from TileJSON. */
let cachedTileUrlTemplate: string | null = null;

/**
 * Resolve the OpenFreeMap vector tile URL template from TileJSON.
 * Returns a URL like `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf`.
 */
async function getTileUrlTemplate(): Promise<string | null> {
  if (cachedTileUrlTemplate) return cachedTileUrlTemplate;
  try {
    const res = await fetch(OPENFREEMAP_TILEJSON_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { tiles?: string[] };
    if (json.tiles && json.tiles.length > 0) {
      cachedTileUrlTemplate = json.tiles[0];
      return cachedTileUrlTemplate;
    }
    return null;
  } catch {
    return null;
  }
}

export interface DownloadProgress {
  regionId: string;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
  stage: 'tiles' | 'routing' | 'geocoding' | 'complete' | 'error';
  error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

export async function downloadRegion(region: Region, onProgress?: ProgressCallback): Promise<void> {
  const destDir = `${FileSystem.documentDirectory}regions/${region.id}/`;
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });

  const db = await getDatabase();

  // Update region status to downloading
  await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
    'downloading',
    Math.floor(Date.now() / 1000),
    region.id,
  ]);

  try {
    // Try P2P download first if a drive key is known
    const peerSuccess = region.driveKey
      ? await tryPeerDownload(region, destDir, onProgress)
      : false;

    if (!peerSuccess) {
      await downloadViaHttp(region, destDir, onProgress);
    }

    // Calculate total size
    const dirInfo = await FileSystem.getInfoAsync(destDir);
    const totalSize = (dirInfo as { size?: number }).size ?? 0;

    // Mark as downloaded
    await db.runAsync(
      'UPDATE regions SET download_status = ?, downloaded_at = ?, last_updated = ? WHERE id = ?',
      ['complete', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), region.id],
    );

    await updatePeerMetrics({ cacheSizeBytes: totalSize });

    onProgress?.({
      regionId: region.id,
      totalBytes: totalSize,
      downloadedBytes: totalSize,
      percent: 100,
      stage: 'complete',
    });

    // Auto-seed the downloaded region so other peers can fetch from us
    autoSeedRegion(region.id, destDir, db).catch(() => {
      // Non-fatal — seeding failure shouldn't affect the download result
    });
  } catch (error) {
    await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
      'failed',
      Math.floor(Date.now() / 1000),
      region.id,
    ]);

    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'error',
      error: (error as Error).message,
    });

    throw error;
  }
}

/** Attempt to download region data from P2P peers. Returns true if successful. */
async function tryPeerDownload(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  if (!region.driveKey) return false;
  try {
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'tiles',
    });

    await downloadFromPeers(region.driveKey, destDir, (_file, _bytes, totalBytes) => {
      onProgress?.({
        regionId: region.id,
        totalBytes,
        downloadedBytes: totalBytes,
        percent: Math.min(99, totalBytes > 0 ? 50 : 0),
        stage: 'tiles',
      });
    });

    return true;
  } catch {
    // P2P failed — fall through to HTTP
    return false;
  }
}

/** Download region vector tiles from OpenFreeMap for offline use. */
async function downloadViaHttp(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const urlTemplate = await getTileUrlTemplate();
  if (!urlTemplate) {
    throw new Error(
      'Could not reach OpenFreeMap. Please check your internet connection and try again.',
    );
  }

  const tilesDir = `${destDir}tiles/`;
  await FileSystem.makeDirectoryAsync(tilesDir, { intermediates: true });

  // Calculate tile coordinates for the region bounds at zoom levels 0-14
  const minZoom = 0;
  const maxZoom = 14;
  const tileCoords = getTilesForBounds(region.bounds, minZoom, maxZoom);
  const totalTiles = tileCoords.length;
  let downloaded = 0;

  onProgress?.({
    regionId: region.id,
    totalBytes: totalTiles,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
  });

  // Download tiles in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < tileCoords.length; i += BATCH_SIZE) {
    const batch = tileCoords.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const url = urlTemplate
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(y));
        const tileDir = `${tilesDir}${z}/${x}/`;
        await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true });
        const dest = `${tileDir}${y}.pbf`;
        try {
          await FileSystem.downloadAsync(url, dest);
        } catch {
          // Skip individual tile failures (ocean tiles, etc.)
        }
      }),
    );
    downloaded += batch.length;
    onProgress?.({
      regionId: region.id,
      totalBytes: totalTiles,
      downloadedBytes: downloaded,
      percent: Math.round((downloaded / totalTiles) * 100),
      stage: 'tiles',
    });
  }
}

/** Convert lat/lng to tile coordinates at a given zoom level. */
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Get all tile coordinates covering a bounding box across zoom levels. */
function getTilesForBounds(
  bounds: Region['bounds'],
  minZoom: number,
  maxZoom: number,
): { z: number; x: number; y: number }[] {
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const topLeft = latLngToTile(bounds.maxLat, bounds.minLng, z);
    const bottomRight = latLngToTile(bounds.minLat, bounds.maxLng, z);
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** Seed a downloaded region in the background and persist the drive key. */
async function autoSeedRegion(
  regionId: string,
  filesDir: string,
  db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<void> {
  const { key } = await seedRegion(regionId, filesDir);
  await db.runAsync('UPDATE regions SET drive_key = ? WHERE id = ?', [key, regionId]);
}

export function cancelDownload(_regionId: string): void {
  // Downloads use batch tile fetching — cancellation is a no-op for now
}

export async function deleteRegionData(regionId: string): Promise<void> {
  // Stop seeding this region via Hyperdrive
  unseedRegion(regionId).catch(() => {});

  const destDir = `${FileSystem.documentDirectory}regions/${regionId}/`;
  const info = await FileSystem.getInfoAsync(destDir);
  if (info.exists) {
    await FileSystem.deleteAsync(destDir, { idempotent: true });
  }

  const db = await getDatabase();
  await db.runAsync(
    'UPDATE regions SET download_status = ?, downloaded_at = NULL, drive_key = NULL, last_updated = ? WHERE id = ?',
    ['none', Math.floor(Date.now() / 1000), regionId],
  );
}
