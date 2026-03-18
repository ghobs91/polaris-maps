import { getDatabase } from '../database/init';
import { getEntry as getHypercoreEntry } from '../../native/hypercore';
import type { StreetImagery } from '../../models/imagery';

export async function getImageryNearby(
  lat: number,
  lng: number,
  radiusKm: number = 0.5,
  limit: number = 50,
): Promise<StreetImagery[]> {
  const db = await getDatabase();
  const latDelta = radiusKm / 111.0;
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

  const rows = await db.getAllAsync<ImageryRow>(
    `SELECT * FROM street_imagery
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
     ORDER BY captured_at DESC
     LIMIT ?`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, limit],
  );

  return rows.map(rowToImagery);
}

export async function getImageryByGeohash(geohash8: string): Promise<StreetImagery[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ImageryRow>(
    'SELECT * FROM street_imagery WHERE geohash8 = ? ORDER BY captured_at DESC',
    [geohash8],
  );
  return rows.map(rowToImagery);
}

export async function getImageryById(id: string): Promise<StreetImagery | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ImageryRow>('SELECT * FROM street_imagery WHERE id = ?', [id]);
  return row ? rowToImagery(row) : null;
}

export async function fetchImageData(feedKey: string, seq: number): Promise<Uint8Array | null> {
  return getHypercoreEntry(feedKey, seq);
}

interface ImageryRow {
  id: string;
  author_pubkey: string;
  lat: number;
  lng: number;
  geohash8: string;
  bearing: number;
  captured_at: number;
  image_hash: string;
  hypercore_feed_key: string;
  feed_seq: number;
  width: number;
  height: number;
  blurred: number;
  signature: string;
}

function rowToImagery(row: ImageryRow): StreetImagery {
  return {
    id: row.id,
    authorPubkey: row.author_pubkey,
    lat: row.lat,
    lng: row.lng,
    geohash8: row.geohash8,
    bearing: row.bearing,
    capturedAt: row.captured_at,
    imageHash: row.image_hash,
    hypercoreFeedKey: row.hypercore_feed_key,
    feedSeq: row.feed_seq,
    width: row.width,
    height: row.height,
    blurred: row.blurred === 1,
    signature: row.signature,
  };
}
