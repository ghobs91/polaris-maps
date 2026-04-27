import * as FileSystem from 'expo-file-system';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { downloadFromPeers, seedRegion, unseedRegion } from '../sync/hyperdriveBridge';
import { joinRegionFeed, leaveRegionFeed } from '../sync/feedSyncService';
import { OPENFREEMAP_TILEJSON_URL } from '../../constants/config';
import type { Region } from '../../models/region';

/** Cached OpenFreeMap tile URL template resolved from TileJSON. */
let cachedTileUrlTemplate: string | null = null;
/** Cached latest tile version (date-stamp from tile URL). */
let cachedTileVersion: string | null = null;
/** Timestamp of the last TileJSON fetch (to allow re-fetch after TTL). */
let tileVersionFetchedAt: number = 0;
/** How long to cache the tile version before re-fetching (1 hour). */
const TILE_VERSION_TTL_MS = 3_600_000;

interface TileJsonResult {
  urlTemplate: string;
  /** Date-stamp from the tile URL path, e.g. "20260422_001001_pt". */
  tileVersion: string;
}

/**
 * Fetch OpenFreeMap TileJSON and extract both the tile URL template and the
 * tile build version (date-stamp embedded in the tile URL path).
 *
 * The tile URL looks like:
 *   https://tiles.openfreemap.org/planet/20260422_001001_pt/{z}/{x}/{y}.pbf
 * We extract "20260422_001001_pt" as the version identifier.
 */
async function fetchTileJson(): Promise<TileJsonResult | null> {
  // Return cached result if still fresh
  if (
    cachedTileUrlTemplate &&
    cachedTileVersion &&
    Date.now() - tileVersionFetchedAt < TILE_VERSION_TTL_MS
  ) {
    return { urlTemplate: cachedTileUrlTemplate, tileVersion: cachedTileVersion };
  }

  try {
    const res = await fetch(OPENFREEMAP_TILEJSON_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { tiles?: string[] };
    if (!json.tiles || json.tiles.length === 0) return null;

    cachedTileUrlTemplate = json.tiles[0];
    cachedTileVersion = extractTileVersion(json.tiles[0]);
    tileVersionFetchedAt = Date.now();

    return { urlTemplate: cachedTileUrlTemplate, tileVersion: cachedTileVersion! };
  } catch {
    // Return stale cache if available as fallback
    if (cachedTileUrlTemplate && cachedTileVersion) {
      return { urlTemplate: cachedTileUrlTemplate, tileVersion: cachedTileVersion };
    }
    return null;
  }
}

/**
 * Extract the tile build version stamp from a tile URL.
 *
 * URL format: https://tiles.openfreemap.org/planet/YYYYMMDD_HHMMSS_pt/{z}/{x}/{y}.pbf
 * Extracts: "YYYYMMDD_HHMMSS_pt"
 */
function extractTileVersion(tileUrl: string): string {
  // Match the date-stamp pattern in the URL path
  const match = tileUrl.match(/\/planet\/(\d{8}_\d{6}_pt)\//);
  return match?.[1] ?? '';
}

/**
 * Resolve just the OpenFreeMap tile URL template (backward-compatible wrapper).
 */
async function getTileUrlTemplate(): Promise<string | null> {
  const result = await fetchTileJson();
  return result?.urlTemplate ?? null;
}

/**
 * Get the latest tile version from OpenFreeMap (date-stamp of the current build).
 */
export async function fetchLatestTileVersion(): Promise<string | null> {
  const result = await fetchTileJson();
  return result?.tileVersion ?? null;
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

  // Fetch latest tile version from OpenFreeMap to decide P2P vs HTTP
  const latestVersion = await fetchLatestTileVersion();

  try {
    let usedP2P = false;

    // Only try P2P if:
    // 1. A drive key is known (peers have seeded this region)
    // 2. We either verified the version matches latest, OR we can't reach
    //    OpenFreeMap at all (offline fallback — best effort from peers)
    if (region.driveKey) {
      const versionOk =
        !latestVersion || // offline — trust P2P as best effort
        region.tileVersion === latestVersion; // version matches latest
      if (versionOk) {
        usedP2P = await tryPeerDownload(region, destDir, onProgress);
      }
    }

    checkAborted(signal);

    if (!usedP2P) {
      await downloadViaHttp(region, destDir, onProgress, signal);
    }

    checkAborted(signal);

    // Offline Overture places should come from bundled region assets. Live
    // viewport POIs now use Overture-hosted PMTiles directly.
    await prefetchOverturePlaces(region, onProgress).catch(() => {});

    checkAborted(signal);

    // Download and import geocoding bundle if the region has a geocoding URL.
    await downloadAndImportGeocodingBundle(region, destDir, onProgress, signal).catch(() => {});

    // Calculate total size
    const dirInfo = await FileSystem.getInfoAsync(destDir);
    const totalSize = (dirInfo as { size?: number }).size ?? 0;

    // Mark as downloaded, storing the tile version from the source used.
    // For P2P: keep the existing stored version (already verified or offline best effort).
    // For HTTP: always store the latest version from OpenFreeMap.
    const downloadedVersion = usedP2P ? (region.tileVersion ?? latestVersion) : latestVersion;
    await db.runAsync(
      'UPDATE regions SET download_status = ?, downloaded_at = ?, last_updated = ?, tile_version = ? WHERE id = ?',
      [
        'complete',
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
        downloadedVersion ?? null,
        region.id,
      ],
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
 * Placeholder progress stage for Overture region data.
 *
 * Offline Overture places should come from bundled region extracts such as
 * `overture-places.geojson`, imported separately after download. Live Overture
 * fetching uses Overture-hosted PMTiles rather than a region-wide query
 * backend or Polaris-hosted service.
 */
export async function prefetchOverturePlaces(
  region: Region,
  onProgress?: ProgressCallback,
): Promise<void> {
  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'places',
  });

  onProgress?.({
    regionId: region.id,
    totalBytes: 0,
    downloadedBytes: 0,
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
  joinRegionFeed(regionId, key).catch(() => {});
}

export function cancelDownload(_regionId: string): void {
  // Downloads use batch tile fetching — cancellation is a no-op for now
}

export async function deleteRegionData(regionId: string): Promise<void> {
  const db = await getDatabase();

  // Read drive_key before nullifying so we can leave the feed
  const row = await db.getFirstAsync<{ drive_key: string | null }>(
    'SELECT drive_key FROM regions WHERE id = ?',
    [regionId],
  );

  // Stop seeding via Hyperdrive and leave the feed
  unseedRegion(regionId).catch(() => {});
  if (row?.drive_key) {
    leaveRegionFeed(row.drive_key).catch(() => {});
  }

  const destDir = `${FileSystem.documentDirectory}regions/${regionId}/`;
  const info = await FileSystem.getInfoAsync(destDir);
  if (info.exists) {
    await FileSystem.deleteAsync(destDir, { idempotent: true });
  }

  await db.runAsync(
    'UPDATE regions SET download_status = ?, downloaded_at = NULL, drive_key = NULL, tile_version = NULL, last_updated = ? WHERE id = ?',
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

    NodeChannel.send(JSON.stringify({ type: 'gunzip', inputPath, outputPath, requestId }));
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
        id: number;
        text: string;
        type: string;
        housenumber: string | null;
        street: string | null;
        city: string | null;
        state: string | null;
        postcode: string | null;
        country: string | null;
        lat: number;
        lng: number;
        region_id: string | null;
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
            row.text,
            row.type,
            row.housenumber,
            row.street,
            row.city,
            row.state,
            row.postcode,
            row.country,
            row.lat,
            row.lng,
            region.id,
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
    await appDb.runAsync('UPDATE regions SET geocoding_size_bytes = ? WHERE id = ?', [
      fileSize,
      region.id,
    ]);
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
