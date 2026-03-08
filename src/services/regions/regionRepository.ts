import { getDatabase } from '../database/init';
import type { Region, RegionDownloadStatus } from '../../models/region';

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
       pmtiles_tx_id, routing_graph_tx_id, geocoding_db_tx_id, version,
       download_status, tiles_size_bytes, routing_size_bytes, geocoding_size_bytes,
       downloaded_at, last_updated, drive_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      region.id,
      region.name,
      region.bounds.minLat,
      region.bounds.maxLat,
      region.bounds.minLng,
      region.bounds.maxLng,
      region.pmtilesTxId,
      region.routingGraphTxId,
      region.geocodingDbTxId,
      region.version,
      region.downloadStatus,
      region.tilesSizeBytes,
      region.routingSizeBytes,
      region.geocodingSizeBytes,
      region.downloadedAt,
      region.lastUpdated,
      region.driveKey,
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
  await db.runAsync('DELETE FROM regions WHERE id = ?', [id]);
}

interface RegionRow {
  id: string;
  name: string;
  bounds_min_lat: number;
  bounds_max_lat: number;
  bounds_min_lng: number;
  bounds_max_lng: number;
  pmtiles_tx_id: string | null;
  routing_graph_tx_id: string | null;
  geocoding_db_tx_id: string | null;
  version: string;
  download_status: string;
  tiles_size_bytes: number | null;
  routing_size_bytes: number | null;
  geocoding_size_bytes: number | null;
  downloaded_at: number | null;
  last_updated: number | null;
  drive_key: string | null;
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
    pmtilesTxId: row.pmtiles_tx_id,
    routingGraphTxId: row.routing_graph_tx_id,
    geocodingDbTxId: row.geocoding_db_tx_id,
    version: row.version,
    downloadStatus: row.download_status as RegionDownloadStatus,
    tilesSizeBytes: row.tiles_size_bytes,
    routingSizeBytes: row.routing_size_bytes,
    geocodingSizeBytes: row.geocoding_size_bytes,
    downloadedAt: row.downloaded_at,
    lastUpdated: row.last_updated,
    driveKey: row.drive_key ?? null,
  };
}
