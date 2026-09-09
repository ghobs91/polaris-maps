import * as FileSystem from 'expo-file-system/legacy';
import {
  startTileServer,
  addTileSource,
  listTileSources,
  getTileServerBaseUrl,
} from '../../native/tileServer';
import { getDownloadedRegions, getRegionContainingPoint } from '../regions/regionRepository';

/**
 * Serves downloaded region vector packs to MapLibre over loopback HTTP.
 *
 * Packs live at `regions/{id}/tiles/{z}/{x}/{y}.pbf` (z0–12). Each complete
 * region is registered with the native `PolarisTileServer` as
 * `offline-{regionId}` → `…/regions/{id}/tiles/`, so tiles resolve at
 * `{baseUrl}/offline-{regionId}/{z}/{x}/{y}.pbf` (see `offlineStyle` for the
 * style rewrite that points vector sources there).
 *
 * iOS only: the native module has no Android implementation, so every entry
 * point resolves to `null` there and callers fall back to the raster compat
 * style. All failures are silent — offline is best-effort, never fatal.
 */

const SOURCE_PREFIX = 'offline-';

let serverBaseUrl: string | null = null;
let startAttempted = false;
const registeredSources = new Set<string>();

/** Loopback base URL once the server is up, else `null`. */
export function getOfflineTileBaseUrl(): string | null {
  return serverBaseUrl;
}

/** Strip the `file://` scheme: native `URL(fileURLWithPath:)` needs a raw path. */
export function toNativePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

/** Source id for a region (`offline-{id}`, sanitised for URL paths). */
export function offlineSourceId(regionId: string): string {
  return `${SOURCE_PREFIX}${regionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function tilesDirForRegion(regionId: string): string {
  const docDir = FileSystem.documentDirectory ?? '';
  return toNativePath(`${docDir}regions/${regionId}/tiles/`);
}

/**
 * Start the loopback tile server (idempotent — the native module keeps a
 * single listener) and register all complete region packs. Returns the base
 * URL, or `null` when the native module is unavailable (Android).
 */
export async function ensureOfflineTileServer(): Promise<string | null> {
  if (serverBaseUrl) return serverBaseUrl;
  if (startAttempted) return null;
  startAttempted = true;
  try {
    const port = await startTileServer({ cachePath: `${FileSystem.cacheDirectory}`, port: 0 });
    const baseUrl = getTileServerBaseUrl();
    if (port > 0 && baseUrl) {
      serverBaseUrl = baseUrl;
      await syncOfflineSources().catch(() => {});
    }
  } catch {
    serverBaseUrl = null;
  }
  return serverBaseUrl;
}

/** Register every complete region pack with the running server (best-effort). */
export async function syncOfflineSources(): Promise<void> {
  if (!serverBaseUrl) return;
  let regions: Awaited<ReturnType<typeof getDownloadedRegions>>;
  try {
    regions = await getDownloadedRegions();
  } catch {
    return;
  }
  let existingIds = new Set<string>();
  try {
    existingIds = new Set((await listTileSources()).map((s) => s.id));
  } catch {
    // Fall through with an empty set — addTileSource is idempotent per id.
  }
  for (const region of regions) {
    const sourceId = offlineSourceId(region.id);
    if (registeredSources.has(sourceId) || existingIds.has(sourceId)) {
      registeredSources.add(sourceId);
      continue;
    }
    try {
      const info = await FileSystem.getInfoAsync(
        `${FileSystem.documentDirectory}regions/${region.id}/tiles/`,
      );
      if (!info.exists) continue;
      await addTileSource({ id: sourceId, filePath: tilesDirForRegion(region.id) });
      registeredSources.add(sourceId);
    } catch {
      // One bad pack must not block the rest.
    }
  }
}

export interface OfflinePack {
  regionId: string;
  sourceId: string;
  tileBaseUrl: string;
}

/**
 * Return the downloaded pack covering (`lat`, `lng`), registering its tiles
 * directory on demand. `null` when offline serving is unavailable (server
 * down / Android) or no complete pack covers the point.
 */
export async function getOfflinePackForPoint(
  lat: number,
  lng: number,
): Promise<OfflinePack | null> {
  const baseUrl = serverBaseUrl ?? (await ensureOfflineTileServer());
  if (!baseUrl) return null;
  let region: Awaited<ReturnType<typeof getRegionContainingPoint>>;
  try {
    region = await getRegionContainingPoint(lat, lng);
  } catch {
    return null;
  }
  if (!region) return null;
  const sourceId = offlineSourceId(region.id);
  if (!registeredSources.has(sourceId)) {
    try {
      const info = await FileSystem.getInfoAsync(
        `${FileSystem.documentDirectory}regions/${region.id}/tiles/`,
      );
      if (!info.exists) return null;
      await addTileSource({ id: sourceId, filePath: tilesDirForRegion(region.id) });
      registeredSources.add(sourceId);
    } catch {
      return null;
    }
  }
  return { regionId: region.id, sourceId, tileBaseUrl: baseUrl };
}
