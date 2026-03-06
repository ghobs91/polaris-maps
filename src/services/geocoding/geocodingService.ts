import { getDatabase } from '../database/init';
import type { GeocodingEntry } from '../../models/geocoding';

export interface GeocodingResult {
  entry: GeocodingEntry;
  rank: number;
}

export async function searchAddress(query: string, limit: number = 10): Promise<GeocodingResult[]> {
  if (!query.trim()) return [];
  const db = await getDatabase();

  // FTS5 match query — add * for prefix matching
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .map((w) => `"${w}"*`)
    .join(' ');

  const rows = await db.getAllAsync<GeocodingRow>(
    `SELECT g.id, g.type, g.housenumber, g.street, g.city, g.state, g.postcode, g.country,
            g.lat, g.lng, e.rank
     FROM geocoding_entries e
     JOIN geocoding_data g ON g.id = e.rowid
     WHERE geocoding_entries MATCH ?
     ORDER BY e.rank
     LIMIT ?`,
    [ftsQuery, limit],
  );

  return rows.map((row, i) => ({
    entry: {
      id: row.id,
      text: formatEntry(row),
      type: row.type as GeocodingEntry['type'],
      housenumber: row.housenumber,
      street: row.street,
      city: row.city,
      state: row.state,
      postcode: row.postcode,
      country: row.country,
      lat: row.lat,
      lng: row.lng,
    },
    rank: row.rank ?? i,
  }));
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  radiusKm: number = 0.5,
): Promise<GeocodingEntry | null> {
  const db = await getDatabase();

  // Approximate bounding box
  const latDelta = radiusKm / 111.0;
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

  const row = await db.getFirstAsync<GeocodingRow>(
    `SELECT id, type, housenumber, street, city, state, postcode, country, lat, lng
     FROM geocoding_data
     WHERE lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
     ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?))
     LIMIT 1`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, lat, lat, lng, lng],
  );

  if (!row) return null;

  return {
    id: row.id,
    text: formatEntry(row),
    type: row.type as GeocodingEntry['type'],
    housenumber: row.housenumber,
    street: row.street,
    city: row.city,
    state: row.state,
    postcode: row.postcode,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
  };
}

interface GeocodingRow {
  id: number;
  type: string;
  housenumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  lat: number;
  lng: number;
  rank?: number;
}

function formatEntry(row: GeocodingRow): string {
  const parts: string[] = [];
  if (row.housenumber && row.street) {
    parts.push(`${row.housenumber} ${row.street}`);
  } else if (row.street) {
    parts.push(row.street);
  }
  if (row.city) parts.push(row.city);
  if (row.state) parts.push(row.state);
  if (row.postcode) parts.push(row.postcode);
  return parts.join(', ') || `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`;
}
