import { getDatabase } from '../database/init';
import type { GeocodingEntry } from '../../models/geocoding';

export interface GeocodingResult {
  entry: GeocodingEntry;
  rank: number;
}

export async function searchAddress(
  query: string,
  limit: number = 10,
  lat?: number,
  lng?: number,
): Promise<GeocodingResult[]> {
  if (!query.trim()) return [];

  // Try local DB first
  const localResults = await searchAddressLocal(query, limit);
  if (localResults.length > 0) return localResults;

  // Fall back to Nominatim online geocoding
  return searchAddressNominatim(query, limit, lat, lng);
}

async function searchAddressLocal(query: string, limit: number): Promise<GeocodingResult[]> {
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

async function searchAddressNominatim(
  query: string,
  limit: number,
  lat?: number,
  lng?: number,
): Promise<GeocodingResult[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(limit),
    });

    // Proximity bias when reference coordinates are available
    if (lat != null && lng != null) {
      params.set('lat', String(lat));
      params.set('lon', String(lng));
      params.set('viewbox', `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`);
      params.set('bounded', '0');
    }

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': 'PolarisMaps/1.0',
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) return [];

    const data: NominatimResult[] = await response.json();

    return data.map((item, i) => ({
      entry: {
        id: Number(item.place_id),
        text: item.display_name,
        type: mapNominatimType(item.type),
        housenumber: item.address?.house_number ?? null,
        street: item.address?.road ?? null,
        city: item.address?.city ?? item.address?.town ?? item.address?.village ?? null,
        state: item.address?.state ?? null,
        postcode: item.address?.postcode ?? null,
        country: item.address?.country ?? null,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      },
      rank: i,
    }));
  } catch {
    return [];
  }
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

function mapNominatimType(type: string): GeocodingEntry['type'] {
  const mapping: Record<string, GeocodingEntry['type']> = {
    house: 'address',
    residential: 'address',
    city: 'city',
    town: 'city',
    village: 'city',
    administrative: 'place',
    state: 'place',
    country: 'place',
  };
  return mapping[type] ?? 'address';
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
