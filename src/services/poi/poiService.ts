import { getGun } from '../gun/init';
import { getDatabase } from '../database/init';
import { encode as geohashEncode } from '../../utils/geohash';
import { sign, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import type { Place, PlaceCategory } from '../../models/poi';
import { PLACE_CATEGORIES } from '../../models/poi';
import { haversineMeters } from '../../utils/routeSnap';
import { searchDocs } from '../search/searchIndex';

export async function getPlaceById(uuid: string): Promise<Place | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<PlaceRow>('SELECT * FROM places WHERE uuid = ?', [uuid]);
  return row ? rowToPlace(row) : null;
}

/**
 * Resolve a map-selected POI to the `places.uuid` the details screen loads.
 * Matches a local place by name within `radiusMeters` of the coordinates.
 * Returns null when nothing matches (e.g. an un-cached OSM or dropped pin),
 * letting the caller show an actionable message instead of a dead link.
 */
export async function findPlaceIdNear(
  lat: number,
  lng: number,
  name: string,
  radiusMeters = 100,
): Promise<string | null> {
  const db = await getDatabase();
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  const rows = await db.getAllAsync<{ uuid: string; lat: number; lng: number; name: string }>(
    `SELECT uuid, lat, lng, name FROM places
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta],
  );

  const target = name.trim().toLowerCase();
  let exact: { uuid: string; distance: number } | null = null;
  let partial: { uuid: string; distance: number } | null = null;
  let nearest: { uuid: string; distance: number } | null = null;

  for (const row of rows) {
    const distance = haversineMeters([lng, lat], [row.lng, row.lat]);
    if (distance > radiusMeters) continue;
    if (!nearest || distance < nearest.distance) nearest = { uuid: row.uuid, distance };

    const rowName = row.name.trim().toLowerCase();
    if (!rowName) continue;
    if (rowName === target) {
      if (!exact || distance < exact.distance) exact = { uuid: row.uuid, distance };
    } else if (rowName.includes(target) || target.includes(rowName)) {
      if (!partial || distance < partial.distance) partial = { uuid: row.uuid, distance };
    }
  }

  // Prefer an exact name match, then a containment match, then the nearest
  // place in range (so a tapped POI is rarely a dead end when the local index
  // has a near-equivalent entry).
  return (exact ?? partial ?? nearest)?.uuid ?? null;
}

/**
 * FTS5-powered text search on the places table.
 * Supports prefix matching, tokenized multi-word queries, and weighted
 * bm25 relevance (name ≫ brand ≫ category ≫ city). Falls back to LIKE search
 * if FTS table is empty or query fails.
 */
export interface PlaceSearchResult extends Place {
  /** Normalized full-text relevance (0–1) from bm25 column weights. */
  ftsRelevance?: number;
}

/** Map a raw SQLite bm25() value (negative, lower = better) to 0–1. */
export { normalizeBm25 } from '../search/searchIndex';

/**
 * Place search over the unified index.
 *
 * `search_docs` is the single ranked index behind place *and* address search
 * (see `search/searchIndex.ts`); `places` stays the detail store. Ranking
 * happens once in the index, then the matching rows are hydrated by uuid so
 * the caller still receives full `Place` records.
 */
export async function searchPlacesFts(
  query: string,
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number = 50,
): Promise<PlaceSearchResult[]> {
  if (!query.trim()) return [];

  const hits = await searchDocs({
    query,
    kinds: ['poi'],
    bbox: { south, west, north, east },
    limit,
  });

  if (hits.length > 0) {
    const ranked = hits.filter((hit) => hit.refId);
    const uuids = ranked.map((hit) => hit.refId as string);
    try {
      const db = await getDatabase();
      const placeholders = uuids.map(() => '?').join(', ');
      const rows = await db.getAllAsync<PlaceRow>(
        `SELECT * FROM places WHERE uuid IN (${placeholders})`,
        uuids,
      );
      const byUuid = new Map(rows.map((row) => [row.uuid as string, row]));
      const relevance = new Map(ranked.map((hit) => [hit.refId as string, hit.relevance]));
      return uuids
        .map((uuid) => byUuid.get(uuid))
        .filter((row): row is PlaceRow => row != null)
        .map((row) => ({
          ...rowToPlace(row),
          ftsRelevance: relevance.get(row.uuid as string) ?? 0,
        }));
    } catch {
      // Fall through to the LIKE path.
    }
  }

  // Fallback: LIKE search with bbox filter
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places
     WHERE (name LIKE ? OR brand_name LIKE ?)
       AND lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
       AND status = 'open'
     ORDER BY avg_rating DESC NULLS LAST
     LIMIT ?`,
    [`%${query}%`, `%${query}%`, south, north, west, east, limit],
  );
  return rows.map(rowToPlace);
}

export async function getNearbyPlaces(
  lat: number,
  lng: number,
  radiusKm: number = 1,
  category?: PlaceCategory,
): Promise<Place[]> {
  const db = await getDatabase();
  const latDelta = radiusKm / 111.0;
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

  let sql = `SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND status = 'open'`;
  const params: (string | number)[] = [
    lat - latDelta,
    lat + latDelta,
    lng - lngDelta,
    lng + lngDelta,
  ];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY ((lat - ?) * (lat - ?) + (lng - ?) * (lng - ?)) LIMIT 50';
  params.push(lat, lat, lng, lng);

  const rows = await db.getAllAsync<PlaceRow>(sql, params);
  return rows.map(rowToPlace);
}

/**
 * Retrieve cached places (Overture + community) within a bounding box.
 * Used by the map viewport to display Overture POIs alongside OSM data.
 *
 * Backed by `idx_places_bounds (status, lat, lng)`. The `status` equality
 * leads so SQLite seeks directly into the `lat` range rather than scanning the
 * table; `lng` is applied as a residual filter. Street-level viewports (the
 * common case) use the index; a viewport covering most of the table may still
 * fall back to a scan.
 */
export async function getPlacesInBounds(
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number = 100,
): Promise<Place[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places
     WHERE status = 'open'
       AND lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
     ORDER BY avg_rating DESC NULLS LAST
     LIMIT ?`,
    [south, north, west, east, limit],
  );
  return rows.map(rowToPlace);
}

/**
 * Search for places by one or more categories within a bounding box.
 * This is the primary local (Overture-backed) category search. Returns
 * pre-processed Overture places that were imported via region download
 * or a previous online fetch.
 */
export async function searchPlacesByCategory(
  categories: PlaceCategory[],
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number = 100,
): Promise<Place[]> {
  if (categories.length === 0) return [];
  const db = await getDatabase();

  const placeholders = categories.map(() => '?').join(', ');
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places
     WHERE category IN (${placeholders})
       AND lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
       AND status = 'open'
     ORDER BY avg_rating DESC NULLS LAST
     LIMIT ?`,
    [...categories, south, north, west, east, limit],
  );
  return rows.map(rowToPlace);
}

export async function createPlace(
  place: Omit<
    Place,
    'signature' | 'authorPubkey' | 'createdAt' | 'updatedAt' | 'avgRating' | 'reviewCount'
  >,
): Promise<Place> {
  if (!PLACE_CATEGORIES.includes(place.category)) {
    throw new Error(`Invalid category: ${place.category}`);
  }

  const keypair = await getOrCreateKeypair();
  const now = Math.floor(Date.now() / 1000);
  const geohash8 = geohashEncode(place.lat, place.lng, 8);

  const payload = createSigningPayload(
    place.uuid,
    place.name,
    String(place.lat),
    String(place.lng),
    String(now),
  );
  const signature = await sign(payload, keypair.privateKey);

  const fullPlace: Place = {
    ...place,
    geohash8,
    authorPubkey: keypair.publicKey,
    signature,
    avgRating: undefined,
    reviewCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  // Write to Gun.js
  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('poi')
    .get(geohash8)
    .get(place.uuid)
    .put({
      ...placeToGunRecord(fullPlace),
    });

  // Cache in SQLite
  await upsertPlaceCache(fullPlace);

  return fullPlace;
}

export async function updatePlace(
  uuid: string,
  updates: Partial<Pick<Place, 'name' | 'category' | 'phone' | 'website' | 'hours' | 'status'>>,
): Promise<Place> {
  const existing = await getPlaceById(uuid);
  if (!existing) throw new Error(`Place not found: ${uuid}`);

  const keypair = await getOrCreateKeypair();
  const now = Math.floor(Date.now() / 1000);

  const merged = { ...existing, ...updates, updatedAt: now };
  const payload = createSigningPayload(
    merged.uuid,
    merged.name,
    String(merged.lat),
    String(merged.lng),
    String(now),
  );
  merged.signature = await sign(payload, keypair.privateKey);
  merged.authorPubkey = keypair.publicKey;

  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('poi')
    .get(merged.geohash8)
    .get(uuid)
    .put(placeToGunRecord(merged));

  await upsertPlaceCache(merged);
  return merged;
}

async function upsertPlaceCache(place: Place): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO places (
      uuid, name, category, lat, lng, geohash8,
      address_street, address_city, address_state, address_postcode, address_country,
      phone, website, yelp, social_media, emails, brand_name, hours, avg_rating, review_count,
      status, source, author_pubkey, signature, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      place.uuid,
      place.name,
      place.category,
      place.lat,
      place.lng,
      place.geohash8,
      place.addressStreet ?? null,
      place.addressCity ?? null,
      place.addressState ?? null,
      place.addressPostcode ?? null,
      place.addressCountry ?? null,
      place.phone ?? null,
      place.website ?? null,
      place.yelp ?? null,
      place.socials?.length ? JSON.stringify(place.socials) : null,
      place.emails?.length ? JSON.stringify(place.emails) : null,
      place.brandName ?? null,
      place.hours ?? null,
      place.avgRating ?? null,
      place.reviewCount ?? 0,
      place.status,
      place.source,
      place.authorPubkey,
      place.signature,
      place.createdAt,
      place.updatedAt,
    ],
  );
}

function placeToGunRecord(p: Place): Record<string, unknown> {
  return {
    uuid: p.uuid,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    geohash8: p.geohash8,
    address_street: p.addressStreet,
    address_city: p.addressCity,
    address_state: p.addressState,
    address_postcode: p.addressPostcode,
    address_country: p.addressCountry,
    phone: p.phone,
    website: p.website,
    yelp: p.yelp,
    social_media: p.socials?.length ? JSON.stringify(p.socials) : undefined,
    emails: p.emails?.length ? JSON.stringify(p.emails) : undefined,
    brand_name: p.brandName,
    hours: p.hours,
    status: p.status,
    source: p.source,
    author_pubkey: p.authorPubkey,
    signature: p.signature,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

interface PlaceRow {
  uuid: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  geohash8: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  phone: string | null;
  website: string | null;
  yelp: string | null;
  social_media: string | null;
  emails: string | null;
  brand_name: string | null;
  hours: string | null;
  avg_rating: number | null;
  review_count: number | null;
  status: string;
  source: string;
  author_pubkey: string;
  signature: string;
  created_at: number;
  updated_at: number;
}

function rowToPlace(row: PlaceRow): Place {
  return {
    uuid: row.uuid,
    name: row.name,
    category: row.category as PlaceCategory,
    lat: row.lat,
    lng: row.lng,
    geohash8: row.geohash8,
    addressStreet: row.address_street ?? undefined,
    addressCity: row.address_city ?? undefined,
    addressState: row.address_state ?? undefined,
    addressPostcode: row.address_postcode ?? undefined,
    addressCountry: row.address_country ?? undefined,
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    yelp: row.yelp ?? undefined,
    socials: row.social_media ? (JSON.parse(row.social_media) as string[]) : undefined,
    emails: row.emails ? (JSON.parse(row.emails) as string[]) : undefined,
    brandName: row.brand_name ?? undefined,
    hours: row.hours ?? undefined,
    avgRating: row.avg_rating ?? undefined,
    reviewCount: row.review_count ?? 0,
    status: row.status as Place['status'],
    source: row.source as Place['source'],
    authorPubkey: row.author_pubkey,
    signature: row.signature,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
