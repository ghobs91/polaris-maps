import { getDatabase } from '../database/init';
import type { Region, RegionDownloadStatus } from '../../models/region';
import { invalidateSearchCacheForBbox } from '../search/searchCache';

export async function getAllRegions(): Promise<Region[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RegionRow>('SELECT * FROM regions ORDER BY name');
  return rows.map(rowToRegion);
}

export async function getRegionById(id: string): Promise<Region | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RegionRow>('SELECT * FROM regions WHERE id = ?', [id]);
  return row ? rowToRegion(row) : null;
}

export async function getRegionContainingPoint(lat: number, lng: number): Promise<Region | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RegionRow>(
    `SELECT * FROM regions
     WHERE bounds_min_lat <= ? AND bounds_max_lat >= ?
       AND bounds_min_lng <= ? AND bounds_max_lng >= ?
       AND download_status = 'complete'
     LIMIT 1`,
    [lat, lat, lng, lng],
  );
  return row ? rowToRegion(row) : null;
}

/**
 * The pack-backed region covering a point, smallest first, in any download
 * state.
 *
 * Distinct from {@link getRegionContainingPoint}, which only returns regions
 * that are already `complete` and is therefore useless for deciding *what to
 * download*. Auto-download needs the candidate, so this ignores status and
 * picks the smallest area that covers the point — the metro pack rather than a
 * state that happens to contain it.
 *
 * Only regions with a pack manifest qualify: offering one without assets would
 * route the user to the capped per-tile path, which is the failure this whole
 * path exists to avoid.
 */
export async function getPackRegionContainingPoint(
  lat: number,
  lng: number,
): Promise<Region | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RegionRow>(
    `SELECT * FROM regions
      WHERE bounds_min_lat <= ? AND bounds_max_lat >= ?
        AND bounds_min_lng <= ? AND bounds_max_lng >= ?
        -- A manifest that does not parse is not a pack: downloadRegion would
        -- fall back to the capped per-tile path, which is the outcome this
        -- query exists to avoid. The CASE guards json_array_length, which
        -- raises on malformed JSON rather than returning NULL.
        AND json_valid(assets_json)
        AND CASE WHEN json_type(assets_json) = 'array'
                 THEN json_array_length(assets_json) ELSE 0 END > 0
      ORDER BY (bounds_max_lat - bounds_min_lat) * (bounds_max_lng - bounds_min_lng) ASC
      LIMIT 1`,
    [lat, lat, lng, lng],
  );
  return row ? rowToRegion(row) : null;
}

export async function getDownloadedRegions(): Promise<Region[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RegionRow>(
    "SELECT * FROM regions WHERE download_status = 'complete' ORDER BY name",
  );
  return rows.map(rowToRegion);
}

export async function upsertRegion(region: Region): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO regions (
       id, name, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
       version, download_status, tiles_size_bytes, routing_size_bytes, geocoding_size_bytes,
       downloaded_at, last_updated, drive_key, geocoding_url, places_url, places_size_bytes,
       tile_version, assets_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      region.id,
      region.name,
      region.bounds.minLat,
      region.bounds.maxLat,
      region.bounds.minLng,
      region.bounds.maxLng,
      region.version,
      region.downloadStatus,
      region.tilesSizeBytes,
      region.routingSizeBytes,
      region.geocodingSizeBytes,
      region.downloadedAt,
      region.lastUpdated,
      region.driveKey,
      region.geocodingUrl,
      region.placesUrl,
      region.placesSizeBytes,
      region.tileVersion,
      // The pack manifest decides whether a download uses the pack or the
      // capped per-tile path, so it has to survive a round-trip.
      region.assets && region.assets.length > 0 ? JSON.stringify(region.assets) : null,
    ],
  );
}

export async function updateDownloadStatus(
  id: string,
  status: RegionDownloadStatus,
): Promise<void> {
  const db = await getDatabase();
  const params: (string | number)[] = [status];
  let sql = 'UPDATE regions SET download_status = ?';
  if (status === 'complete') {
    sql += ', downloaded_at = ?';
    params.push(Math.floor(Date.now() / 1000));
  }
  sql += ' WHERE id = ?';
  params.push(id);
  await db.runAsync(sql, params);
}

export async function deleteRegion(id: string): Promise<void> {
  const db = await getDatabase();

  // Capture bounds before the row disappears so cached search results for the
  // region can be invalidated.
  const bounds = await db.getFirstAsync<{
    bounds_min_lat: number;
    bounds_max_lat: number;
    bounds_min_lng: number;
    bounds_max_lng: number;
  }>(
    'SELECT bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng FROM regions WHERE id = ?',
    [id],
  );

  await db.runAsync('DELETE FROM regions WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM geocoding_data WHERE region_id = ?', [id]);
  await db.runAsync("INSERT INTO geocoding_entries(geocoding_entries) VALUES('rebuild')");
  await db.runAsync("INSERT INTO geocoding_trigram(geocoding_trigram) VALUES('rebuild')");

  if (bounds) {
    invalidateSearchCacheForBbox({
      south: bounds.bounds_min_lat,
      north: bounds.bounds_max_lat,
      west: bounds.bounds_min_lng,
      east: bounds.bounds_max_lng,
    });
  }
}

interface RegionRow {
  id: string;
  name: string;
  bounds_min_lat: number;
  bounds_max_lat: number;
  bounds_min_lng: number;
  bounds_max_lng: number;
  version: string;
  download_status: string;
  tiles_size_bytes: number | null;
  routing_size_bytes: number | null;
  geocoding_size_bytes: number | null;
  downloaded_at: number | null;
  last_updated: number | null;
  drive_key: string | null;
  geocoding_url: string | null;
  places_url: string | null;
  places_size_bytes: number | null;
  tile_version: string | null;
  assets_json: string | null;
}

/**
 * Pack manifest from a row, tolerating anything.
 *
 * `downloadRegion` chooses between the pack path and the capped per-tile path
 * from `assets`, so a corrupt or half-written row must degrade to "no assets"
 * rather than throw: the region still downloads, it just uses the tile path.
 * Entries missing a name or URL are dropped for the same reason.
 */
function parseAssets(raw: string | null): Region['assets'] {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const assets = parsed.filter(
      (entry): entry is { name: string; url: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { name?: unknown }).name === 'string' &&
        typeof (entry as { url?: unknown }).url === 'string',
    );
    return assets.length > 0 ? (assets as Region['assets']) : undefined;
  } catch {
    return undefined;
  }
}

function rowToRegion(row: RegionRow): Region {
  return {
    id: row.id,
    name: row.name,
    bounds: {
      minLat: row.bounds_min_lat,
      maxLat: row.bounds_max_lat,
      minLng: row.bounds_min_lng,
      maxLng: row.bounds_max_lng,
    },
    version: row.version,
    downloadStatus: row.download_status as RegionDownloadStatus,
    tilesSizeBytes: row.tiles_size_bytes,
    routingSizeBytes: row.routing_size_bytes,
    geocodingSizeBytes: row.geocoding_size_bytes,
    downloadedAt: row.downloaded_at,
    lastUpdated: row.last_updated,
    driveKey: row.drive_key ?? null,
    geocodingUrl: row.geocoding_url ?? null,
    placesUrl: row.places_url ?? null,
    placesSizeBytes: row.places_size_bytes ?? null,
    assets: parseAssets(row.assets_json),
    tileVersion: row.tile_version ?? null,
  };
}
