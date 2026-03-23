import { getGun } from '../gun/init';
import { getDatabase } from '../database/init';
import { encode as geohashEncode } from '../../utils/geohash';
import { sign, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import type { Place, PlaceCategory } from '../../models/poi';
import { PLACE_CATEGORIES } from '../../models/poi';

export async function getPlaceById(uuid: string): Promise<Place | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<PlaceRow>('SELECT * FROM places WHERE uuid = ?', [uuid]);
  return row ? rowToPlace(row) : null;
}

export async function searchPlaces(query: string, limit: number = 20): Promise<Place[]> {
  if (!query.trim()) return [];
  const db = await getDatabase();
  // Using the places table with name/category indexes
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT * FROM places WHERE name LIKE ? OR category LIKE ? ORDER BY avg_rating DESC LIMIT ?`,
    [`%${query}%`, `%${query}%`, limit],
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
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND status = 'open'
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
      phone, website, social_media, emails, brand_name, hours, avg_rating, review_count,
      status, source, author_pubkey, signature, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
