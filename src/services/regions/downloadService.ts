import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '../database/init';
import { updatePeerMetrics } from '../sync/peerService';
import { downloadFromPeers, gunzipFile, seedRegion, unseedRegion } from '../sync/hyperdriveBridge';
import { joinRegionFeed, leaveRegionFeed } from '../sync/feedSyncService';
import {
  OPENFREEMAP_TILEJSON_URL,
  OPENFREEMAP_USER_AGENT,
  TRANSIT_TIMETABLE_ASSET,
} from '../../constants/config';
import {
  OPENFREEMAP_MAX_DOWNLOAD_BYTES,
  OPENFREEMAP_MAX_PARALLEL_DOWNLOADS,
  planOfflineTileDownload,
} from './tileDownloadPlan';
import { downloadOfflineFonts } from '../map/offlineFonts';
import { syncOfflineSources } from '../map/offlineMapService';
import type { Region } from '../../models/region';
import { cacheDotGtfsForRegion } from '../transit/dotGtfsOffline';
import { removeOfflineDotGtfsData } from '../transit/dotGtfsOffline';
import { invalidateSearchCacheForBbox } from '../search/searchCache';
import {
  importRegionOverturePlaces,
  importRegionOverturePlacesFromSqlite,
} from './overtureImporter';
import { importRegionPlaceDetails } from './placeDetailImporter';
import { importPackSearchIndices, registerPackTimetable } from './packIndices';
import { registerPackShards } from './shardCatalog';
import { extractTar } from '../../utils/archiveExtract';
import { downloadRoutingGraphsForRegion, pruneUnusedRoutingGraphs } from '../routing/routingGraphs';
import { getRegionManifest } from './regionManifestResolver';
import { useSettingsStore, type PackSourceChoice } from '../../stores/settingsStore';
import {
  isP2pOnly,
  preferredSources,
  resolveSourceClass,
  synthesizeMirrorUrl,
} from './packSourcePolicy';
import { resolvePackMirrorBase } from './packMirrorSource';
import {
  buildSourceList,
  downloadResumable,
  localAssetState,
  planAssetDownloads,
} from './assetDownload';
import { orderMirrorSources, recordMirrorFailure, recordMirrorSuccess } from './mirrorHealth';
import type { RegionAsset } from '../../models/region';
import { isFeatureEnabled } from '../config/remoteConfig';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import { usePeerStore } from '../../stores/peerStore';
import { shouldTryPeerDownload } from './peerDownloadPolicy';
import { shouldSeedLocallyOnDevice } from './relaySeedingPolicy';
import { getRelayCoverage, isRegionRelayCovered } from '../relay/relayAnnouncements';
import { getConnectivity } from './connectivityService';

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
      headers: {
        Accept: 'application/json',
        'User-Agent': OPENFREEMAP_USER_AGENT,
      },
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
  /** Human-readable region name, attached by the download manager for UI labels. */
  regionName?: string;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
  stage:
    | 'peers'
    | 'tiles'
    | 'unpack'
    | 'finalizing'
    | 'places'
    | 'routing'
    | 'geocoding'
    | 'indices'
    | 'complete'
    | 'error';
  error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Bound a best-effort step.
 *
 * The post-transfer steps (label fonts, places, geocoding, search indices,
 * routing graphs) are all `.catch(() => {})` so they cannot *fail* the
 * download — but a catch does not help a request that never settles. Each of
 * these made un-timed-out network calls, so one stalled connection left the
 * whole download hanging forever with the progress bar frozen on the previous
 * stage. A timeout turns "hang forever" into "skip this part", which is what
 * best-effort already meant.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return Promise.race([
    work,
    new Promise<undefined>((resolve) => {
      setTimeout(() => {
        logDiagnostic('regions', 'warn', `timed out: ${label}`, { ms });
        resolve(undefined);
      }, ms);
    }),
  ]);
}

/** Per-step budget for the post-transfer imports. */
const POST_TRANSFER_STEP_TIMEOUT_MS = 120_000;

/**
 * Routing graphs get their own, much larger budget.
 *
 * A single metro tarball is large — `us-ny-new-york-routing.tar` is 247 MB — and
 * it is extracted on top of the transfer. The 2-minute post-transfer budget
 * abandoned that step mid-download, which looked exactly like "the region
 * downloaded fine but routing never works".
 */
const ROUTING_GRAPH_STEP_TIMEOUT_MS = 15 * 60_000;

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
  if (!isFeatureEnabled('regionDownloads')) {
    throw new Error('Offline downloads are temporarily unavailable. Please try again later.');
  }

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

    // Only try P2P if a canonical key is known — either the region's stored
    // key or the bundled/verified manifest key (so a fresh install can fetch
    // from peers before hitting any origin). Also require the version to match
    // latest, unless we're offline and treating peers as best effort.
    const canonicalKey = region.driveKey ?? getRegionManifest(region.id)?.driveKey ?? null;

    /**
     * Developer "P2P" source: the pack must come from the mesh.
     *
     * This deliberately skips every gate that normally shortens the peer attempt
     * (`shouldTryPeerDownload` exists to avoid burning 120 s before falling back to
     * an origin), and it never falls back: a visible failure is the answer the
     * developer asked for. Without that, "P2P" would just be a slower route to the
     * same CDN and would prove nothing.
     */
    /**
     * Developer "P2P" source: the pack must come from the mesh.
     *
     * Deliberately skips every gate that normally shortens the peer attempt
     * (`shouldTryPeerDownload` exists to avoid burning 120 s before falling back to an
     * origin) and never falls back, because a visible failure is the answer the
     * developer asked for. The result still flows through the shared tail below, so
     * places, indices, the region status and seeding all behave exactly as a normal
     * download — only the bytes' origin changes.
     */
    if (isP2pOnly(packSourceChoiceFor(region.id))) {
      if (!canonicalKey) {
        // No key means no discovery key, which means no swarm topic to search.
        throw new Error(
          `No canonical key is published for “${region.name}”, so there is no swarm ` +
            'topic to search. A relay can publish one (Mac app → Map catalog → Publish & seed).',
        );
      }

      const relayCovered = isRegionRelayCovered(region.id);
      logDiagnostic('regions', 'info', 'P2P-only download started', {
        regionId: region.id,
        relayCovered,
        activePeers: usePeerStore.getState().activePeers,
      });
      onProgress?.({
        regionId: region.id,
        regionName: region.name,
        totalBytes: 0,
        downloadedBytes: 0,
        percent: 0,
        stage: 'peers',
      });

      const served = await tryPeerDownload(region, destDir, onProgress, canonicalKey);
      if (!served) {
        logDiagnostic('regions', 'warn', 'P2P-only download found no seeder', {
          regionId: region.id,
          relayCovered,
        });
        throw new Error(
          'No peer or relay finished seeding this pack. Nothing was downloaded and no ' +
            'origin was tried — that is what the P2P source does. Check that a device is ' +
            'seeding it: the Mac relay lists what it seeds under Desktop relay.',
        );
      }

      usedP2P = true;
    }

    // …and only when there is actually a peer to ask — see peerDownloadPolicy.
    const hasHttpFallback = (region.assets?.length ?? 0) > 0 || (region.tilesSizeBytes ?? 0) > 0;
    const peersConnected = usePeerStore.getState().activePeers > 0;
    const peerWorthTrying = shouldTryPeerDownload({
      canonicalKey,
      peersConnected,
      relayCovers: isRegionRelayCovered(region.id),
      hasHttpFallback,
    });
    if (canonicalKey && !peerWorthTrying) {
      logDiagnostic('regions', 'info', `skipping P2P for ${region.id}: no peers connected`);
    }
    if (peerWorthTrying && !usedP2P) {
      const versionOk =
        !latestVersion || // offline — trust P2P as best effort
        region.tileVersion === latestVersion; // version matches latest
      if (versionOk) {
        usedP2P = await tryPeerDownload(region, destDir, onProgress, canonicalKey);
      }
    }

    checkAborted(signal);

    if (!usedP2P) {
      const shippedTiles = (region.assets ?? []).find((a) => a.name === TILES_PMTILES);
      if (shippedTiles) {
        // The pack carries a base-map PMTiles archive: expand it into the
        // per-tile tree the local tile server serves, so a downloaded region
        // renders from local bytes with no third-party tile requests.
        await downloadTilesArchive(region, destDir, shippedTiles, onProgress, signal);
      } else {
        await downloadViaHttp(region, destDir, onProgress, signal);
      }
    }

    checkAborted(signal);

    // Everything below finishes the install (label fonts, places, geocoding,
    // search indices, routing graphs). None of it reports progress, and it runs
    // after the last byte has arrived — without its own stage the bar froze on
    // "Expanding map files…" while these ran.
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 100,
      stage: 'finalizing',
    });

    // Bundle label fonts (shared across all regions) so the offline vector
    // style can render place labels with no connection. Best-effort.
    await withTimeout(downloadOfflineFonts(), POST_TRANSFER_STEP_TIMEOUT_MS, 'offline fonts').catch(
      () => {},
    );

    // Offline Overture places should come from bundled region assets. Live
    // viewport POIs now use Overture-hosted PMTiles directly.
    await withTimeout(
      prefetchOverturePlaces(region, onProgress, signal),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'places prefetch',
    ).catch(() => {});

    checkAborted(signal);

    // Download and import geocoding bundle if the region has a geocoding URL.
    await withTimeout(
      downloadAndImportGeocodingBundle(region, destDir, onProgress, signal),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'geocoding bundle',
    ).catch((error: unknown) => {
      // Best-effort by design, but total silence is what hid a schema mismatch
      // that made every CI-built pack unimportable: the region still reported
      // "complete", just without the addresses it had already downloaded.
      logDiagnostic('regions', 'warn', 'geocoding import failed', {
        regionId: region.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    checkAborted(signal);

    // Seed the place-detail cache from an optional region-pack payload. Region
    // seeds use sourceVersion 0 so they never clobber fresher live snapshots.
    await withTimeout(
      importRegionPlaceDetails(destDir),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'place details',
    ).catch(() => {});

    checkAborted(signal);

    // Fetch and import the pack's on-device search indices (POIs + transit).
    // These are what let a covered viewport answer without Overpass; a pack
    // that omits them still works, it just keeps the network fallback.
    await withTimeout(
      downloadPackSearchIndices(region, destDir, onProgress, signal),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'search indices',
    ).catch(() => {});
    await withTimeout(
      importPackSearchIndices(region.id, destDir, region.bounds),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'search index import',
    ).catch(() => {});
    // The timetable is registered where it lies rather than imported — see
    // `registerPackTimetable`. Absent in most packs today, so this is a no-op
    // until a region publishes one.
    await withTimeout(
      registerPackTimetable(region.id, destDir, region.bounds),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'timetable registration',
    ).catch(() => {});

    // Shards let a viewport just outside the pack's coverage be answered from
    // the pack's own verified bytes instead of a network query service. They are
    // part of the pack, so peers seeding it already serve them.
    await withTimeout(
      registerPackShards(region.id, destDir),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'shard registration',
    ).catch(() => {});

    checkAborted(signal);

    // DOT GTFS pre-caching — download transit feed data for offline transit lines.
    await withTimeout(
      cacheDotGtfsForRegion(region.id, region.bounds),
      POST_TRANSFER_STEP_TIMEOUT_MS,
      'GTFS pre-cache',
    ).catch(() => {});

    checkAborted(signal);

    // Offline routing graphs (Valhalla) for the metro catalog entries this pack
    // actually covers. Best-effort: a failed routing fetch must not fail the
    // tile download — but it must be visible, so the outcome is logged and
    // recorded for the routing badge instead of discarded.
    const routingStatus = await withTimeout(
      downloadRoutingGraphsForRegion(region, onProgress, signal),
      ROUTING_GRAPH_STEP_TIMEOUT_MS,
      'routing graphs',
    ).catch((err: unknown) => {
      logDiagnostic('regions', 'warn', `routing graphs failed for ${region.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    });

    if (routingStatus?.skipped) {
      logDiagnostic('regions', 'warn', `routing graphs skipped for ${region.id}`, {
        skipped: routingStatus.skipped,
        reason:
          routingStatus.skipped === 'untrusted-pack-bounds'
            ? 'pack bounds span too much longitude for metro targeting'
            : 'pack covers no metro catalog entry',
      });
    } else if (routingStatus && routingStatus.failed.length > 0) {
      logDiagnostic('regions', 'warn', `routing graphs incomplete for ${region.id}`, {
        installed: routingStatus.installed,
        failed: routingStatus.failed,
      });
    }

    checkAborted(signal);

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

    // Register the freshly expanded tiles with the loopback tile server now,
    // not on the next MapView mount. Otherwise a pack that just finished reads
    // as complete in the DB while the map still has no source for it.
    await syncOfflineSources().catch(() => {});

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
      // Clean up the partial download directory and reset status.
      //
      // `none` is the only valid "nothing downloaded" status; this used to
      // write `not_downloaded`, which is not in RegionDownloadStatus at all. A
      // cancelled region then matched no branch in RegionCard, so its Download
      // button disappeared permanently and the region could never be retried.
      await FileSystem.deleteAsync(destDir, { idempotent: true }).catch(() => {});
      await db.runAsync('UPDATE regions SET download_status = ?, last_updated = ? WHERE id = ?', [
        'none',
        Math.floor(Date.now() / 1000),
        region.id,
      ]);
      return;
    }

    // Any failed download leaves its partial files behind, and a pack asset is
    // resumed from a sidecar offset. A truncated archive therefore resumes from
    // a bad offset, fails the checksum, and fails identically on every retry —
    // the region is stuck on "Failed" until it is deleted by hand. The region
    // never reached `complete`, so nothing in the directory is usable: drop it
    // and let Retry start clean. (Over-limit downloads are refused rather than
    // completed non-conformantly, which this also covers.)
    await FileSystem.deleteAsync(destDir, { idempotent: true }).catch(() => {});

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

    logDiagnostic('regions', 'error', `download failed: ${region.id}`, {
      message: (error as Error).message,
    });
    throw error;
  }
}

/** Attempt to download region data from P2P peers. Returns true if successful. */
async function tryPeerDownload(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
  driveKey?: string | null,
): Promise<boolean> {
  const key = driveKey ?? region.driveKey ?? getRegionManifest(region.id)?.driveKey ?? null;
  if (!key) return false;
  try {
    onProgress?.({
      regionId: region.id,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      stage: 'tiles',
    });

    await downloadFromPeers(key, destDir, (_file, _bytes, totalBytes) => {
      onProgress?.({
        regionId: region.id,
        totalBytes,
        downloadedBytes: totalBytes,
        percent: Math.min(99, totalBytes > 0 ? 50 : 0),
        stage: 'tiles',
      });
    });

    // Peer packs may ship an uncompressed routing.tar; extract it in place so
    // the graph is usable (the routing graph store scans region packs too).
    const routingTar = `${destDir}routing.tar`;
    try {
      if ((await FileSystem.getInfoAsync(routingTar)).exists) {
        await extractTar(
          routingTar.replace(/^file:\/\//, ''),
          `${destDir}routing/`.replace(/^file:\/\//, ''),
        );
        await FileSystem.deleteAsync(routingTar, { idempotent: true });
      }
    } catch {
      // Extraction failed — keep the region data and fall back to online routing.
    }

    return true;
  } catch {
    // P2P failed — fall through to HTTP
    return false;
  }
}

/**
 * Download (when the catalog advertises a `placesUrl`) and import the region's
 * Overture places extract into the local `places` table, so viewport POI
 * fetches have local data to serve without a network round-trip.
 *
 * Region packs published over P2P may instead ship an uncompressed
 * `overture-places.geojson` in the region directory; that path is imported
 * directly. Live viewport POIs still use Overture-hosted PMTiles.
 */
export async function prefetchOverturePlaces(
  region: Region,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  const totalBytes = region.placesSizeBytes ?? 0;
  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: 0,
    percent: 0,
    stage: 'places',
  });

  const regionDir = `${FileSystem.documentDirectory}regions/${region.id}/`;
  try {
    let imported = 0;

    if (region.placesUrl) {
      // The catalog bundle is gzipped; a `.sqlite.gz` URL is the memory-safe
      // prebuilt bundle, anything else is a GeoJSON extract.
      const isSqlite = region.placesUrl.endsWith('.sqlite.gz');
      const gzPath = `${regionDir}overture-places.bundle.gz`;
      const outPath = `${regionDir}${
        isSqlite ? 'overture-places.sqlite' : 'overture-places.geojson'
      }`;

      checkAborted(signal);
      await FileSystem.downloadAsync(region.placesUrl, gzPath);
      checkAborted(signal);
      await gunzipViaNode(gzPath, outPath);
      checkAborted(signal);

      imported = isSqlite
        ? await importRegionOverturePlacesFromSqlite(outPath)
        : await importRegionOverturePlaces(regionDir);
      if (imported > 0) {
        console.warn(`[regions] imported ${imported} Overture places for ${region.id}`);
      }

      // The decompressed bundle is redundant once imported.
      await FileSystem.deleteAsync(outPath, { idempotent: true }).catch(() => {});
      await FileSystem.deleteAsync(gzPath, { idempotent: true }).catch(() => {});
    } else {
      // P2P-seeded packs may ship an uncompressed extract in the region dir.
      imported = await importRegionOverturePlaces(regionDir);
      if (imported > 0) {
        console.warn(`[regions] imported ${imported} Overture places for ${region.id}`);
      }
    }

    if (imported > 0) {
      invalidateSearchCacheForBbox({
        south: region.bounds.minLat,
        north: region.bounds.maxLat,
        west: region.bounds.minLng,
        east: region.bounds.maxLng,
      });
    }
  } catch (error) {
    // Cancellation must propagate; a missing/invalid extract is non-fatal.
    if ((error as Error).name === 'AbortError') throw error;
  }

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: totalBytes,
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

  // Stay inside OpenFreeMap's offline-download allowance: at most 3,000 tiles
  // per download. Lowering max zoom cuts the tile count ~4x per level, so a
  // too-large region degrades to a coarser pack instead of an over-limit one.
  const plan = planOfflineTileDownload(region.bounds);
  if (plan.reduced) {
    console.warn(
      `[Regions] ${region.id}: capped offline detail at z${plan.maxZoom} to stay within OpenFreeMap's tile limit.`,
    );
    logDiagnostic('regions', 'warn', `capped offline detail for ${region.id}`, {
      maxZoom: plan.maxZoom,
      tiles: plan.tiles.length,
    });
  }

  const tilesDir = `${destDir}tiles/`;
  await FileSystem.makeDirectoryAsync(tilesDir, { intermediates: true });

  const totalTiles = plan.tiles.length;
  let downloaded = 0;
  let downloadedBytes = 0;

  onProgress?.({
    regionId: region.id,
    totalBytes: totalTiles,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
  });

  // OpenFreeMap's policy permits at most 4 parallel requests per offline
  // download. Batches stay small deliberately.
  const BATCH_SIZE = OPENFREEMAP_MAX_PARALLEL_DOWNLOADS;
  for (let i = 0; i < plan.tiles.length; i += BATCH_SIZE) {
    checkAborted(signal);
    const batch = plan.tiles.slice(i, i + BATCH_SIZE);
    const batchBytes = await Promise.all(
      batch.map(async ({ z, x, y }) => {
        const url = urlTemplate
          .replace('{z}', String(z))
          .replace('{x}', String(x))
          .replace('{y}', String(y));
        const tileDir = `${tilesDir}${z}/${x}/`;
        await FileSystem.makeDirectoryAsync(tileDir, { intermediates: true });
        const dest = `${tileDir}${y}.pbf`;
        try {
          await FileSystem.downloadAsync(url, dest, {
            headers: { 'User-Agent': OPENFREEMAP_USER_AGENT },
          });
          const info = await FileSystem.getInfoAsync(dest);
          return (info as { size?: number }).size ?? 0;
        } catch {
          // Skip individual tile failures (ocean tiles, etc.)
          return 0;
        }
      }),
    );
    downloadedBytes += batchBytes.reduce((sum, bytes) => sum + bytes, 0);
    if (downloadedBytes > OPENFREEMAP_MAX_DOWNLOAD_BYTES) {
      const err = new Error(
        "Offline map exceeded OpenFreeMap's 50 MB per-download limit. Try a smaller region.",
      );
      err.name = 'DownloadLimitError';
      throw err;
    }
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

/** File name of a pack's base-map archive. */
const TILES_PMTILES = 'tiles.pmtiles';

/**
 * Order an asset's origins for one transfer.
 *
 * The pack is served by GitHub Releases, Cloudflare R2, Backblaze B2 and the
 * Internet Archive. Rotation spreads first attempts across all four instead of
 * funnelling every client at the primary, and origins that recently failed are
 * pushed to the back so their timeout is not paid again.
 *
 * With developer mode on, `regionId` can pin one class of origin (primary or
 * mirror) so each can be exercised on its own. The pin is ignored when the asset
 * carries none of the requested class — falling back beats failing a download
 * because a developer picked "Archive" in a region the catalog advertises no
 * mirror for.
 */
function orderedSourcesFor(asset: RegionAsset, regionId: string): string[] {
  const primary = asset.url ? [asset.url] : [];
  const choice = packSourceChoiceFor(regionId);
  const advertised = asset.mirrors ?? [];
  // Developer-only: reach a mirror the catalog does not advertise yet, so the
  // origin can be exercised before POLARIS_PACK_MIRROR_BASES points every
  // client at it. Synthesised only for an explicit "Archive" pick — an "Auto"
  // download in a dev build must behave exactly like production.
  const mirrors =
    advertised.length > 0 || choice !== 'mirror'
      ? advertised
      : [
          synthesizeMirrorUrl(
            asset.url,
            // Resolved, not raw: an empty setting must still point somewhere, and
            // the published item rolls over monthly.
            resolvePackMirrorBase(useSettingsStore.getState().devPackMirrorBase),
          ),
        ].filter((url): url is string => typeof url === 'string');

  const sourceClass = resolveSourceClass(primary.length > 0, mirrors.length > 0, choice);
  // A pin names what to try first, not the only thing to try: the mirror lags
  // the release by a build cycle, so a strict pin dead-ends on any region not
  // uploaded yet. Auto keeps rotating for load spreading.
  if (sourceClass !== 'all') return preferredSources(primary, mirrors, choice);
  return orderMirrorSources(buildSourceList(asset.url, mirrors));
}

/** Effective developer source pin for a region (`auto` unless devMode is on). */
export function packSourceChoiceFor(regionId: string): PackSourceChoice {
  try {
    const settings = useSettingsStore.getState();
    if (!settings.devMode) return 'auto';
    return settings.packSourcePreferences[regionId] ?? 'auto';
  } catch {
    // Settings unavailable (early boot, tests) — behave like a release build.
    return 'auto';
  }
}

/**
 * Checksum verification for a transferred asset.
 *
 * The catalog's `md5` describes the published file (the `.gz` for gzipped
 * assets), so this runs against the transfer target before any expansion. A
 * mirror that serves the wrong bytes is rejected and demoted rather than
 * expanded into the region directory.
 */
function verifierFor(asset: RegionAsset): ((path: string) => Promise<void>) | undefined {
  if (!asset.md5) return undefined;
  const expected = asset.md5.toLowerCase();
  return async (path: string) => {
    const info = await FileSystem.getInfoAsync(path, { md5: true });
    const actual = (info as { md5?: string }).md5?.toLowerCase();
    if (!actual || actual !== expected) {
      throw new Error(
        `checksum mismatch for ${asset.name} (expected ${expected}, got ${actual ?? 'none'})`,
      );
    }
  };
}

function reportSourceOutcome(source: string, outcome: 'success' | 'failure'): void {
  if (outcome === 'success') recordMirrorSuccess(source);
  else recordMirrorFailure(source);
}

/**
/**
 * Download a pack's base-map archive and keep it as the archive.
 *
 * The native tile server reads individual tiles out of the PMTiles file, so a
 * pack costs exactly its download size on disk.
 */
async function downloadTilesArchive(
  region: Region,
  destDir: string,
  asset: RegionAsset,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  onProgress?.({
    regionId: region.id,
    totalBytes: asset.sizeBytes ?? 0,
    downloadedBytes: 0,
    percent: 0,
    stage: 'tiles',
  });

  const archivePath = `${destDir}${TILES_PMTILES}`;
  const sources = orderedSourcesFor(asset, region.id);
  const startedAt = Date.now();

  const tilesResult = await downloadResumable({
    destPath: archivePath,
    sources,
    signal,
    verify: verifierFor(asset),
    onSourceSettled: reportSourceOutcome,
    onProgress: (p) => {
      onProgress?.({
        regionId: region.id,
        totalBytes: p.totalBytes ?? asset.sizeBytes ?? 0,
        downloadedBytes: p.bytesWritten,
        percent: p.totalBytes ? Math.round((p.bytesWritten / p.totalBytes) * 100) : 0,
        stage: 'tiles',
      });
    },
  });

  checkAborted(signal);

  // The archive stays as-is. The native tile server serves {z}/{x}/{y} out of
  // it by range reads, so there is nothing to expand: expanding a 15.8 MB
  // archive wrote 737,058 files and cost 2.8 GB of filesystem blocks, and the
  // unpack itself took minutes during which the bar could only say "expanding".
  //
  // The archive is kept at `regions/{id}/tiles.pmtiles`; `offlineMapService`
  // registers it as a PMTiles source and falls back to an unpacked `tiles/`
  // tree only for packs downloaded before this existed.
  logDiagnostic('regions', 'info', 'base-map archive downloaded (served directly)', {
    regionId: region.id,
    bytes: asset.sizeBytes ?? 0,
    ms: Date.now() - startedAt,
    // Which origin actually answered. With a source pinned, a mirror miss falls
    // through to the primary, and without this the log would call that a
    // successful mirror download.
    source: tilesResult.source,
  });
}

/**
 * Seed a downloaded region in the background and persist the canonical key.
 *
 * Whether this device should seed at all is a policy decision, not a foregone
 * conclusion: a 50-400 MB pack seeded from a phone's cellular plan and battery is
 * the cost this relay coverage exists to remove (`relaySeedingPolicy`).
 */
async function autoSeedRegion(
  regionId: string,
  filesDir: string,
  db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<void> {
  const coverage = getRelayCoverage(regionId);
  const connectivity = getConnectivity();
  const decision = shouldSeedLocallyOnDevice({
    relayCovers: coverage.covered,
    relayHealthy: coverage.healthy,
    userPref: useSettingsStore.getState().deviceSeeding,
    // Battery state needs `expo-battery`, which is not a dependency, so on-device
    // seeding is not gated on power yet. The relay is the answer to the battery
    // case; this is tracked in the relay change's tasks.
    power: 'charging',
    link: !connectivity.isConnected
      ? 'none'
      : connectivity.type === 'cellular'
        ? 'metered'
        : 'unmetered',
    freeDiskRatio: 2, // the download itself already checked disk headroom
  });

  if (!decision.seed) {
    logDiagnostic('regions', 'info', 'Not seeding downloaded region', {
      regionId,
      reason: decision.reason,
      relay: coverage.relayPubkey ?? 'none',
    });
    return;
  }

  // Seed against the canonical pack key when known (read-only replica shared by
  // every peer); otherwise author the canonical drive on this device.
  const canonicalKey = getRegionManifest(regionId)?.driveKey;

  // A previously stored per-device key is stale under canonical seeding; drop
  // its Hypercore feed once the new key is known.
  const previous = await db.getFirstAsync<{ drive_key: string | null }>(
    'SELECT drive_key FROM regions WHERE id = ?',
    [regionId],
  );

  const { key } = await seedRegion(regionId, filesDir, canonicalKey);
  await db.runAsync('UPDATE regions SET drive_key = ? WHERE id = ?', [key, regionId]);

  const staleKey = previous?.drive_key;
  if (staleKey && staleKey !== key) {
    leaveRegionFeed(staleKey).catch(() => {});
  }
  joinRegionFeed(regionId, key).catch(() => {});
}

export function cancelDownload(_regionId: string): void {
  // Real cancellation lives in downloadManager.cancelBackgroundDownload,
  // which owns the AbortController. Kept for backward compat — callers
  // should migrate to the manager so downloads survive screen unmount.
}

export async function deleteRegionData(regionId: string): Promise<void> {
  const db = await getDatabase();

  // Read drive_key before nullifying so we can leave the feed
  const row = await db.getFirstAsync<{
    drive_key: string | null;
    bounds_min_lat: number;
    bounds_max_lat: number;
    bounds_min_lng: number;
    bounds_max_lng: number;
  }>(
    'SELECT drive_key, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng FROM regions WHERE id = ?',
    [regionId],
  );

  // Stop seeding via Hyperdrive and leave the feed
  unseedRegion(regionId).catch(() => {});
  if (row?.drive_key) {
    leaveRegionFeed(row.drive_key).catch(() => {});
  }

  // Remove cached DOT GTFS data for this region
  removeOfflineDotGtfsData(regionId);

  const destDir = `${FileSystem.documentDirectory}regions/${regionId}/`;
  const info = await FileSystem.getInfoAsync(destDir);
  if (info.exists) {
    await FileSystem.deleteAsync(destDir, { idempotent: true });
  }

  await db.runAsync(
    'UPDATE regions SET download_status = ?, downloaded_at = NULL, drive_key = NULL, tile_version = NULL, last_updated = ? WHERE id = ?',
    ['none', Math.floor(Date.now() / 1000), regionId],
  );

  // Reclaim routing graphs no remaining downloaded region covers.
  await pruneUnusedRoutingGraphs().catch(() => {});

  // Removing an offline region changes local coverage — drop cached network
  // results for the affected area so the next search sees current data.
  if (row) {
    invalidateSearchCacheForBbox({
      south: row.bounds_min_lat,
      north: row.bounds_max_lat,
      west: row.bounds_min_lng,
      east: row.bounds_max_lng,
    });
  }
}

// ---------------------------------------------------------------------------
// Geocoding bundle download & import
// ---------------------------------------------------------------------------

import * as SQLite from 'expo-sqlite';

/**
 * Gunzip a file via the Bare worklet (replaces the dead Node sidecar).
 */
/**
 * Fetch the pack's optional on-device search indices.
 *
 * `search.sqlite` (named POIs) and `transit.sqlite` (stops + route relations)
 * are what let a covered region answer POI and transit queries with no network
 * call. Both are optional and both are served by whatever community/third-party
 * origin hosts the rest of the pack — Polaris runs no CDN; a missing index just
 * leaves the network fallback in place.
 */
async function downloadPackSearchIndices(
  region: Region,
  destDir: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  const assets = packAssetsFor(region, [
    'search.sqlite',
    'transit.sqlite',
    TRANSIT_TIMETABLE_ASSET,
  ]);
  if (assets.length === 0) return;

  // Report one continuous 0→100% across the whole index set. Emitting each
  // asset's own 0→100% made the bar reset three times, and a `percent` of 100
  // on the first file left it pulsing "finishing" while 75 MB was still in
  // flight.
  const totalBytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  let completedBytes = 0;

  for (const asset of assets) {
    checkAborted(signal);

    const assetBytes = asset.sizeBytes ?? 0;
    const base = completedBytes;
    onProgress?.({
      regionId: region.id,
      totalBytes,
      downloadedBytes: base,
      percent: totalBytes > 0 ? Math.round((base / totalBytes) * 100) : 0,
      stage: 'indices',
    });

    await fetchPackAsset(
      region,
      destDir,
      asset,
      (p) => {
        if (!onProgress) return;
        const written = Math.min(assetBytes, p.downloadedBytes);
        const overall = totalBytes > 0 ? Math.round(((base + written) / totalBytes) * 100) : 0;
        onProgress({
          ...p,
          totalBytes,
          downloadedBytes: base + written,
          percent: Math.min(99, overall),
          stage: 'indices',
        });
      },
      signal,
    );

    completedBytes += assetBytes;
  }

  onProgress?.({
    regionId: region.id,
    totalBytes,
    downloadedBytes: totalBytes,
    percent: 100,
    stage: 'indices',
  });
}

/**
 * Resolve the pack manifest for a region, falling back to the per-URL fields
 * for packs published before `assets` existed.
 */
function packAssetsFor(region: Region, names: readonly string[]): RegionAsset[] {
  const declared = (region.assets ?? []).filter((a) => names.includes(a.name));
  if (declared.length > 0) return declared;

  const legacy: RegionAsset[] = [];
  const add = (name: string, url: string | null | undefined) => {
    if (!url) return;
    legacy.push({ name, url, gzip: url.endsWith('.gz') });
  };
  if (names.includes('search.sqlite')) add('search.sqlite', region.searchIndexUrl);
  if (names.includes('transit.sqlite')) add('transit.sqlite', region.transitIndexUrl);
  if (names.includes('geocoding-data.sqlite')) add('geocoding-data.sqlite', region.geocodingUrl);
  return legacy;
}

/**
 * Download one pack asset: skip when the local copy already matches the
 * published checksum (delta), otherwise transfer resumably across mirrors and
 * expand gzipped payloads.
 */
async function fetchPackAsset(
  region: Region,
  destDir: string,
  asset: RegionAsset,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  const finalPath = `${destDir}${asset.name}`;

  // Delta: an unchanged asset costs nothing.
  const local = await localAssetState(destDir, [asset]);
  const { skipped } = planAssetDownloads([asset], local);
  if (skipped.length > 0) {
    logDiagnostic('regions', 'info', `asset unchanged, skipping download`, {
      regionId: region.id,
      asset: asset.name,
    });
    return;
  }

  const tempPath = asset.gzip ? `${finalPath}.gz` : finalPath;
  const sources = orderedSourcesFor(asset, region.id);
  const startedAt = Date.now();

  const assetResult = await downloadResumable({
    destPath: tempPath,
    sources,
    signal,
    verify: verifierFor(asset),
    onSourceSettled: reportSourceOutcome,
    onProgress: (p) => {
      onProgress?.({
        regionId: region.id,
        totalBytes: p.totalBytes ?? 0,
        downloadedBytes: p.bytesWritten,
        percent: p.totalBytes ? Math.round((p.bytesWritten / p.totalBytes) * 100) : 0,
        stage: 'indices',
      });
    },
  });

  checkAborted(signal);
  if (asset.gzip) {
    await gunzipViaNode(tempPath, finalPath);
    await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
  }

  logDiagnostic('regions', 'info', `asset downloaded`, {
    regionId: region.id,
    asset: asset.name,
    ms: Date.now() - startedAt,
    sources: sources.length,
    source: assetResult.source,
  });
}

function gunzipViaNode(inputPath: string, outputPath: string): Promise<void> {
  return gunzipFile(inputPath, outputPath);
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

  // Download the gzipped bundle (resumable + mirror-aware + delta-skipped).
  checkAborted(signal);
  await fetchPackAsset(
    region,
    destDir,
    packAssetsFor(region, ['geocoding-data.sqlite'])[0] ?? {
      name: 'geocoding-data.sqlite',
      url: region.geocodingUrl,
      gzip: true,
    },
    onProgress,
    signal,
  );

  // Decompress via Node.js IPC (skipped when the delta check already left an
  // expanded copy in place).
  checkAborted(signal);
  const gzInfo = await FileSystem.getInfoAsync(gzPath);
  if (gzInfo.exists) {
    await gunzipViaNode(gzPath, dbPath);
    await FileSystem.deleteAsync(gzPath, { idempotent: true }).catch(() => {});
  }

  // Open the downloaded SQLite as read-only
  const srcDb = await SQLite.openDatabaseAsync(dbPath, {
    enableChangeListener: false,
    // The geocoding bundle carries an FTS5 index; see database/init.ts
    // (expo/expo#38168).
    finalizeUnusedStatementsBeforeClosing: false,
  });
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
    await appDb.execAsync("INSERT INTO geocoding_trigram(geocoding_trigram) VALUES('rebuild')");

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
