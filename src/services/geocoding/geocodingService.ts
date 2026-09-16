import { getDatabase } from '../database/init';
import { throwIfAborted, withTimeout } from '../search/abortUtils';
import { nominatimThrottle } from '../search/requestThrottle';
import type { GeocodingEntry } from '../../models/geocoding';
import type { OsmPoi } from '../poi/osmFetcher';

export interface GeocodingResult {
  entry: GeocodingEntry;
  rank: number;
  /** Original POI data from unified search, if this result came from a POI. */
  poi?: OsmPoi;
}

export interface SearchAddressOptions {
  /** Abort a stale in-flight search (e.g. superseded by a newer keystroke). */
  signal?: AbortSignal;
  /** Return local-DB results only — skip the Nominatim network fallback. */
  localOnly?: boolean;
}

export async function searchAddress(
  query: string,
  limit: number = 10,
  lat?: number,
  lng?: number,
  opts?: SearchAddressOptions,
): Promise<GeocodingResult[]> {
  if (!query.trim()) return [];

  // Try local DB first — gracefully fall through to Nominatim on any error
  const localResults = await searchAddressLocal(query, limit, lat, lng).catch(() => []);
  if (localResults.length > 0 || opts?.localOnly) return localResults;
  throwIfAborted(opts?.signal);

  // Fall back to Nominatim online geocoding
  return searchAddressNominatim(query, limit, lat, lng, opts?.signal);
}

// ---------------------------------------------------------------------------
// Structured local address query
// ---------------------------------------------------------------------------

export interface StructuredAddressQuery {
  housenumber?: string;
  street?: string;
  city?: string;
}

/**
 * Best-effort classification of an address query into structured components.
 * Handles "350 fifth avenue, new york" and "123 main st brooklyn" shapes.
 */
export function classifyAddressQuery(query: string): StructuredAddressQuery {
  const segments = query
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return {};

  const result: StructuredAddressQuery = {};
  const first = segments[0];
  const houseMatch = first.match(/^(\d+[a-z]?)\s+(.+)$/i);
  if (houseMatch) {
    result.housenumber = houseMatch[1].toLowerCase();
    result.street = houseMatch[2].toLowerCase();
  } else {
    result.street = first.toLowerCase();
  }
  if (segments[1]) result.city = segments[1].toLowerCase();
  return result;
}

/** Sort rows by squared distance from a reference point (stable when absent). */
export function sortRowsByDistance<T extends { lat: number; lng: number }>(
  rows: T[],
  lat?: number,
  lng?: number,
): T[] {
  if (lat == null || lng == null) return rows;
  return [...rows].sort((a, b) => {
    const da = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    const db = (b.lat - lat) ** 2 + (b.lng - lng) ** 2;
    return da - db;
  });
}

function rowToGeocodingResult(row: GeocodingRow, rank: number): GeocodingResult {
  return {
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
    rank,
  };
}

const GEOCODING_SELECT = `SELECT g.id, g.type, g.housenumber, g.street, g.city, g.state,
        g.postcode, g.country, g.lat, g.lng, e.rank`;

function buildStructuredFtsQuery(structured: StructuredAddressQuery): string | null {
  const parts: string[] = [];
  const token = (value: string) =>
    value
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t}"*`)
      .join(' ');

  if (structured.housenumber && structured.street) {
    parts.push(`{housenumber}:${token(structured.housenumber)}`);
    parts.push(`{street}:${token(structured.street)}`);
  } else if (structured.street) {
    parts.push(`{street}:${token(structured.street)}`);
  }
  if (structured.city) parts.push(`{city}:${token(structured.city)}`);
  return parts.length > 0 ? parts.join(' ') : null;
}

async function searchGeocodingTrigram(query: string, limit: number): Promise<GeocodingResult[]> {
  const text = query
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 4) return [];

  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<GeocodingRow>(
      `SELECT g.id, g.type, g.housenumber, g.street, g.city, g.state, g.postcode, g.country,
              g.lat, g.lng, 100 AS rank
       FROM geocoding_trigram t
       JOIN geocoding_data g ON g.id = t.rowid
       WHERE geocoding_trigram MATCH ?
       LIMIT ?`,
      [`"${text}"`, limit],
    );
    return rows.map((row, i) => rowToGeocodingResult(row, 100 + i));
  } catch {
    return [];
  }
}

async function searchAddressLocal(
  query: string,
  limit: number,
  lat?: number,
  lng?: number,
): Promise<GeocodingResult[]> {
  const db = await getDatabase();
  const structured = classifyAddressQuery(query);

  // Structured query first: house number + street + city as FTS column
  // filters, distance-ranked around the reference point.
  if (structured.street && (structured.housenumber || structured.city)) {
    const structuredFts = buildStructuredFtsQuery(structured);
    if (structuredFts) {
      try {
        const rows = await db.getAllAsync<GeocodingRow>(
          `${GEOCODING_SELECT}
           FROM geocoding_entries e
           JOIN geocoding_data g ON g.id = e.rowid
           WHERE geocoding_entries MATCH ?
           LIMIT 50`,
          [structuredFts],
        );
        if (rows.length > 0) {
          return sortRowsByDistance(rows, lat, lng)
            .slice(0, limit)
            .map((row, i) => rowToGeocodingResult(row, i));
        }
      } catch {
        // Malformed structured query — fall through to free text.
      }
    }
  }

  // FTS5 match query — add * for prefix matching
  // Strip double-quotes to prevent FTS5 syntax injection
  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .map((w) => `"${w.replace(/"/g, '')}"*`)
    .join(' ');

  if (!ftsQuery.replace(/["* ]/g, '')) return [];

  const rows = await db.getAllAsync<GeocodingRow>(
    `${GEOCODING_SELECT}
     FROM geocoding_entries e
     JOIN geocoding_data g ON g.id = e.rowid
     WHERE geocoding_entries MATCH ?
     ORDER BY e.rank
     LIMIT ?`,
    [ftsQuery, Math.max(limit * 3, 30)],
  );

  const primary = sortRowsByDistance(rows, lat, lng).slice(0, limit);
  const results = primary.map((row, i) => rowToGeocodingResult(row, i));

  // Offline typo tolerance: when the primary query is thin, add trigram
  // matches (lower-ranked) for misspelled street/locality names.
  if (results.length >= 3) return results;
  const trigramCandidate = structured.street ?? query;
  const trigram = await searchGeocodingTrigram(trigramCandidate, limit).catch(() => []);
  const seen = new Set(results.map((r) => r.entry.id));
  return [...results, ...trigram.filter((r) => !seen.has(r.entry.id))].slice(0, limit);
}

/** Client-side timeout for Nominatim requests (previously unbounded). */
const NOMINATIM_TIMEOUT_MS = 8_000;

async function searchAddressNominatim(
  query: string,
  limit: number,
  lat?: number,
  lng?: number,
  signal?: AbortSignal,
): Promise<GeocodingResult[]> {
  // Enforce the shared Nominatim rate limit (1 request/second). Abort-aware
  // so a stale keystroke doesn't hold the throttle budget.
  await nominatimThrottle.wait(signal);

  const { signal: fetchSignal, cleanup } = withTimeout(signal, NOMINATIM_TIMEOUT_MS);
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
        signal: fetchSignal,
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
  } catch (err) {
    if (signal?.aborted) throw err;
    return [];
  } finally {
    cleanup();
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
