import { getDatabase } from '../database/init';
import { throwIfAborted, withTimeout } from '../search/abortUtils';
import { nominatimThrottle } from '../search/requestThrottle';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import type { GeocodingEntry } from '../../models/geocoding';
import type { OsmPoi } from '../poi/osmFetcher';
import {
  houseNumbersOnStreet,
  searchDocs,
  searchDocsFuzzy,
  type BoundingBox,
  type SearchDocHit,
} from '../search/searchIndex';
import { interpolateAddressPoint } from '../search/addressInterpolation';

export interface GeocodingResult {
  entry: GeocodingEntry;
  rank: number;
  /** Original POI data from unified search, if this result came from a POI. */
  poi?: OsmPoi;
}

/** Document kinds that answer an address query (POIs are searched separately). */
const ADDRESS_KINDS: SearchDocHit['kind'][] = ['address', 'street', 'locality', 'admin'];

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

  // Local index first — it is the primary path. Nominatim exists only to fill
  // gaps where the downloaded packs have no coverage.
  const localResults = await searchAddressLocal(query, limit, lat, lng).catch(() => []);
  if (localResults.length > 0 || opts?.localOnly) return localResults;
  throwIfAborted(opts?.signal);

  // No local match: fall back to Nominatim, still rate-limited and abortable.
  const remote = await searchAddressNominatim(query, limit, lat, lng, opts?.signal);
  return remote;
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

async function searchGeocodingFuzzy(
  query: string,
  limit: number,
  lat?: number,
  lng?: number,
  bbox?: BoundingBox,
): Promise<GeocodingResult[]> {
  const hits = await searchDocsFuzzy({
    query,
    kinds: ADDRESS_KINDS,
    bbox,
    limit,
    anchor: lat != null && lng != null ? { lat, lng } : undefined,
  }).catch(() => []);
  return hits.map((hit, i) => docToGeocodingResult(hit, 100 + i));
}

/** Map a unified-index document onto the geocoding entry shape. */
function docToGeocodingResult(hit: SearchDocHit, rank: number): GeocodingResult {
  return {
    entry: {
      id: hit.id,
      text: formatDocText(hit),
      type: kindToEntryType(hit.kind),
      housenumber: hit.housenumber,
      street: hit.street,
      city: hit.city,
      state: hit.state,
      postcode: hit.postcode,
      country: hit.country,
      lat: hit.lat,
      lng: hit.lng,
    },
    rank,
  };
}

function kindToEntryType(kind: SearchDocHit['kind']): GeocodingEntry['type'] {
  switch (kind) {
    case 'locality':
      return 'city';
    case 'admin':
      return 'place';
    case 'street':
      return 'street';
    case 'address':
      return 'address';
    default:
      return 'place';
  }
}

function formatDocText(hit: SearchDocHit): string {
  if (hit.kind === 'address' && hit.housenumber && hit.street) {
    return [`${hit.housenumber} ${hit.street}`, hit.city, hit.state, hit.postcode]
      .filter(Boolean)
      .join(', ');
  }
  return hit.name ?? hit.street ?? hit.city ?? '';
}

/**
 * Local address search — the only primary path. The unified index answers from
 * the downloaded packs; Nominatim is a fallback for gaps, never the default.
 */
async function searchAddressLocal(
  query: string,
  limit: number,
  lat?: number,
  lng?: number,
  bbox?: BoundingBox,
): Promise<GeocodingResult[]> {
  const structured = classifyAddressQuery(query);
  const anchor = lat != null && lng != null ? { lat, lng } : undefined;

  // Structured query first: the parsed street/city become the match terms so
  // "350 fifth avenue, new york" doesn't have to match punctuation.
  const matchQuery =
    structured.street && (structured.housenumber || structured.city)
      ? [structured.housenumber, structured.street, structured.city].filter(Boolean).join(' ')
      : query;

  const hits = await searchDocs({
    query: matchQuery,
    kinds: ADDRESS_KINDS,
    bbox,
    anchor,
    limit: Math.max(limit * 3, 30),
  }).catch(() => []);

  const results = hits.slice(0, limit).map((hit, i) => docToGeocodingResult(hit, i));

  // Query-time interpolation: the exact number is missing from the pack, but
  // its neighbours on the same street are known, so place it between them.
  const interpolated = await interpolateMissingNumber(structured, bbox, lat, lng);
  if (interpolated) {
    const seen = new Set(results.map((r) => `${r.entry.housenumber}|${r.entry.street}`));
    if (!seen.has(`${interpolated.entry.housenumber}|${interpolated.entry.street}`)) {
      results.unshift(interpolated);
    }
  }

  if (results.length >= 3) return results.slice(0, limit);
  const fuzzy = await searchGeocodingFuzzy(structured.street ?? query, limit, lat, lng, bbox);
  const seenIds = new Set(results.map((r) => r.entry.id));
  return [...results, ...fuzzy.filter((r) => !seenIds.has(r.entry.id))].slice(0, limit);
}

/**
 * Interpolate an address whose house number is absent from the index.
 *
 * Returns null unless the query has a numeric house number and the street has
 * at least two numbered points around it — a guess without both endpoints is
 * worse than no result.
 */
async function interpolateMissingNumber(
  structured: StructuredAddressQuery,
  bbox?: BoundingBox,
  lat?: number,
  lng?: number,
): Promise<GeocodingResult | null> {
  if (!structured.housenumber || !structured.street) return null;

  const points = await houseNumbersOnStreet(structured.street, { bbox, limit: 400 }).catch(
    () => [],
  );
  if (points.length < 2) return null;

  const resolved = interpolateAddressPoint(structured.housenumber, points);
  if (!resolved || resolved.exact) return null;

  // The synthetic point sits between real neighbours; keep it last among equals
  // by reporting a negative rank so callers can also surface "approximate".
  return {
    entry: {
      id: 0,
      text: formatInterpolatedText(resolved, structured, points),
      type: 'address',
      housenumber: resolved.housenumber,
      street: structured.street,
      city: structured.city ?? null,
      state: null,
      postcode: null,
      country: null,
      lat: resolved.lat,
      lng: resolved.lng,
    },
    rank: lat != null && lng != null ? 0 : -1,
  };
}

function formatInterpolatedText(
  resolved: ReturnType<typeof interpolateAddressPoint>,
  structured: StructuredAddressQuery,
  points: Array<{ housenumber: string }>,
): string {
  const address = [resolved!.housenumber, structured.street, structured.city]
    .filter(Boolean)
    .join(', ');
  const lower = resolved!.lower.housenumber;
  const upper = resolved!.upper.housenumber;
  void points;
  return `${address} (approx. between ${lower} and ${upper})`;
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

    if (!response.ok) {
      logDiagnostic('nominatim', 'warn', `address search failed: HTTP ${response.status}`);
      return [];
    }

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
