import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { downloadFromPeers, seedRegion, unseedRegion } from '../sync/hyperdriveBridge';
import { fetchOverturePlaces } from '../poi/overtureFetcher';
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
  stage: 'tiles' | 'places' | 'routing' | 'geocoding' | 'complete' | 'error';
  error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

/** Throws an AbortError if the signal has been aborted. Works across all RN/Hermes versions. */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Download cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

export async function downloadRegion(
  region: Region,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
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

    checkAborted(signal);

    if (!peerSuccess) {
      await downloadViaHttp(region, destDir, onProgress, signal);
    }

    checkAborted(signal);

    // Bulk-fetch Overture places for the region bounds into local SQLite (non-fatal).
    // Uses OVERTURE_PLACES_URL if configured; skips silently otherwise.
    await prefetchOverturePlaces(region, onProgress).catch(() => {});

    checkAborted(signal);

    // Download and import geocoding bundle if the region has a geocoding URL.
    await downloadAndImportGeocodingBundle(region, destDir, onProgress, signal).catch(() => {});

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
    if ((error as Error).name === 'AbortError') {
      // Clean up the partial download directory and reset status
      await FileSystem.deleteAsync(destDir, { idempotent: true }).catch(() => {});
      await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
        'not_downloaded',
        Math.floor(Date.now() / 1000),
        region.id,
      ]);
      return;
    }

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

/**
 * Pre-fetch Overture places for the entire region bbox and upsert into
 * local SQLite, so category searches work offline after download.
 *
 * Uses the existing OVERTURE_PLACES_URL 3rd-party endpoint.
 * Non-fatal: silently skips if OVERTURE_PLACES_URL is not configured.
 */
export async function prefetchOverturePlaces(
  region: Region,
  onProgress?: ProgressCallback,
): Promise<void> {
  const { minLat, maxLat, minLng, maxLng } = region.bounds;

  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'places',
  });

  // fetchOverturePlaces returns [] immediately if OVERTURE_PLACES_URL is unset
  const places = await fetchOverturePlaces(
    minLat, // south
    minLng, // west
    maxLat, // north
    maxLng, // east
    10_000, // generous limit for region-level seeding
  );

  onProgress?.({
    regionId: region.id,
    totalBytes: places.length,
    downloadedBytes: places.length,
    percent: 100,
    stage: 'places',
  });
}

/** Download region vector tiles from OpenFreeMap for offline use. */
async function downloadViaHttp(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  const urlTemplate = await getTileUrlTemplate();
  if (!urlTemplate) {
    throw new Error(
      'Could not reach OpenFreeMap. Please check your internet connection and try again.',
    );
  }

  const tilesDir = `${destDir}tiles/`;
  await FileSystem.makeDirectoryAsync(tilesDir, { intermediates: true });

  // Calculate tile coordinates for the region bounds at zoom levels 0-12.
  // z12 gives city-level detail in vector tiles (MapLibre renders z13+ from z12 data).
  // Going to z14 multiplies tile count by 16× — far too many for region-scale downloads.
  const minZoom = 0;
  const maxZoom = 12;
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

  // Download tiles in batches of 50 concurrent requests
  const BATCH_SIZE = 50;
  for (let i = 0; i < tileCoords.length; i += BATCH_SIZE) {
    checkAborted(signal);
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

// ---------------------------------------------------------------------------
// Geocoding bundle download & import
// ---------------------------------------------------------------------------

import * as SQLite from 'expo-sqlite';
import { NativeEventEmitter, NativeModules } from 'react-native';

/**
 * Send a gunzip command to the Node.js sidecar via NodeChannel and wait for the result.
 * Uses a unique requestId to avoid races when multiple gunzips run concurrently.
 */
function gunzipViaNode(inputPath: string, outputPath: string): Promise<void> {
  const { NodeChannel } = NativeModules;
  if (!NodeChannel) return Promise.reject(new Error('NodeChannel not available'));

  const requestId = `gunzip_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    const emitter = new NativeEventEmitter(NodeChannel);
    const sub = emitter.addListener('message', (raw: string) => {
      try {
        const data = JSON.parse(raw);
        if (data.requestId !== requestId) return;
        sub.remove();
        if (data.action === 'gunzip_done') {
          resolve();
        } else if (data.action === 'gunzip_error') {
          reject(new Error(data.error));
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    NodeChannel.send(
      JSON.stringify({ type: 'gunzip', inputPath, outputPath, requestId }),
    );
  });
}

/**
 * Download and import a geocoding SQLite bundle for a region.
 *
 * - Downloads the gzipped SQLite from the region's geocodingUrl.
 * - Decompresses via Node.js IPC bridge.
 * - Batch-imports all rows into the main app DB.
 * - Rebuilds the FTS index and cleans up temp files.
 */
async function downloadAndImportGeocodingBundle(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (!region.geocodingUrl) return;

  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'geocoding',
  });

  const gzPath = `${destDir}geocoding-data.sqlite.gz`;
  const dbPath = `${destDir}geocoding-data.sqlite`;

  // Download the gzipped bundle
  checkAborted(signal);
  await FileSystem.downloadAsync(region.geocodingUrl, gzPath);

  // Decompress via Node.js IPC
  checkAborted(signal);
  await gunzipViaNode(gzPath, dbPath);

  // Open the downloaded SQLite as read-only
  const srcDb = await SQLite.openDatabaseAsync(dbPath, { enableChangeListener: false });
  const appDb = await getDatabase();

  try {
    // Count total rows for progress
    const countRow = await srcDb.getFirstAsync<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM geocoding_data',
    );
    const totalRows = countRow?.cnt ?? 0;
    let imported = 0;

    // Batch-insert in chunks of 500
    const BATCH = 500;
    let offset = 0;

    while (offset < totalRows) {
      checkAborted(signal);

      const rows = await srcDb.getAllAsync<{
        id: number; text: string; type: string;
        housenumber: string | null; street: string | null;
        city: string | null; state: string | null;
        postcode: string | null; country: string | null;
        lat: number; lng: number; region_id: string | null;
      }>(
        `SELECT id, text, type, housenumber, street, city, state, postcode, country, lat, lng, region_id
         FROM geocoding_data LIMIT ? OFFSET ?`,
        [BATCH, offset],
      );

      if (rows.length === 0) break;

      for (const row of rows) {
        await appDb.runAsync(
          `INSERT OR IGNORE INTO geocoding_data
             (text, type, housenumber, street, city, state, postcode, country, lat, lng, region_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.text, row.type, row.housenumber, row.street,
            row.city, row.state, row.postcode, row.country,
            row.lat, row.lng, region.id,
          ],
        );
      }

      imported += rows.length;
      offset += BATCH;

      onProgress?.({
        regionId: region.id,
        totalBytes: totalRows,
        downloadedBytes: imported,
        percent: Math.round((imported / totalRows) * 100),
        stage: 'geocoding',
      });
    }

    // Rebuild FTS index
    await appDb.execAsync("INSERT INTO geocoding_entries(geocoding_entries) VALUES('rebuild')");

    // Update geocoding_size_bytes for the region
    const fileInfo = await FileSystem.getInfoAsync(gzPath);
    const fileSize = (fileInfo as { size?: number }).size ?? 0;
    await appDb.runAsync(
      'UPDATE regions SET geocoding_size_bytes = ? WHERE id = ?',
      [fileSize, region.id],
    );
  } finally {
    await srcDb.closeAsync();
  }

  // Clean up temp files
  await FileSystem.deleteAsync(gzPath, { idempotent: true });
  await FileSystem.deleteAsync(dbPath, { idempotent: true });

  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 100,
    stage: 'geocoding',
  });
}
