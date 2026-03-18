import { getDatabase } from '../database/init';
import { encode as geohashEncode } from '../../utils/geohash';
import { OVERTURE_PLACES_URL } from '../../constants/config';
import type { Place, PlaceCategory } from '../../models/poi';
import type { OverturePlace, OverturePlaceCollection } from '../../types/overture';

/**
 * Fetch Overture Maps places for a bounding box and upsert into the local
 * SQLite cache. Returns the converted Place objects.
 *
 * The endpoint should return GeoJSON FeatureCollection conforming to the
 * Overture Places schema. Typically served by:
 *   - A self-hosted DuckDB/WASM proxy
 *   - A pre-exported GeoJSON file per region
 *   - The Overture STAC-backed tile service
 */
export async function fetchOverturePlaces(
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number = 200,
): Promise<Place[]> {
  if (!OVERTURE_PLACES_URL) return [];

  const url = new URL(OVERTURE_PLACES_URL);
  url.searchParams.set('bbox', `${west},${south},${east},${north}`);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Overture Places API returned ${res.status}`);
  }

  const data: OverturePlaceCollection = await res.json();
  if (!data.features?.length) return [];

  const places = data.features.map(overtureFeatureToPlace).filter((p): p is Place => p !== null);

  if (places.length > 0) {
    await upsertOverturePlaces(places);
  }

  return places;
}

/**
 * Import Overture places from a pre-exported GeoJSON file (e.g. bundled
 * with a region download). Upserts into SQLite with source='overture'.
 */
export async function importOverturePlacesFromGeoJSON(
  geojson: OverturePlaceCollection,
): Promise<number> {
  const places = geojson.features.map(overtureFeatureToPlace).filter((p): p is Place => p !== null);

  if (places.length === 0) return 0;
  await upsertOverturePlaces(places);
  return places.length;
}

// ---------------------------------------------------------------------------
// Overture category → Polaris PlaceCategory mapping
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, PlaceCategory> = {
  // Food & drink
  restaurant: 'restaurant',
  asian_restaurant: 'restaurant',
  chinese_restaurant: 'restaurant',
  italian_restaurant: 'restaurant',
  mexican_restaurant: 'restaurant',
  japanese_restaurant: 'restaurant',
  indian_restaurant: 'restaurant',
  thai_restaurant: 'restaurant',
  french_restaurant: 'restaurant',
  american_restaurant: 'restaurant',
  pizza_restaurant: 'restaurant',
  seafood_restaurant: 'restaurant',
  steakhouse: 'restaurant',
  sushi_restaurant: 'restaurant',
  burger_restaurant: 'restaurant',
  barbecue_restaurant: 'restaurant',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  tea_house: 'cafe',
  bar: 'bar',
  pub: 'bar',
  wine_bar: 'bar',
  cocktail_bar: 'bar',
  brewery: 'bar',
  bakery: 'bakery',
  fast_food_restaurant: 'fast_food',
  fast_food: 'fast_food',

  // Shopping
  grocery_store: 'grocery',
  supermarket: 'supermarket',
  convenience_store: 'convenience',
  clothing_store: 'clothing',
  electronics_store: 'electronics',
  hardware_store: 'hardware',
  bookstore: 'bookstore',
  book_store: 'bookstore',

  // Health
  pharmacy: 'pharmacy',
  drugstore: 'pharmacy',
  hospital: 'hospital',
  medical_center: 'hospital',
  clinic: 'clinic',
  doctor: 'clinic',
  dentist: 'dentist',

  // Finance
  bank: 'bank',
  atm: 'atm',
  post_office: 'post_office',

  // Transport
  gas_station: 'gas_station',
  fuel_station: 'gas_station',
  ev_charging_station: 'ev_charging',
  parking: 'parking',
  parking_lot: 'parking',
  parking_garage: 'parking',
  airport: 'airport',
  bus_station: 'bus_station',
  bus_stop: 'bus_station',
  train_station: 'train_station',
  subway_station: 'train_station',

  // Lodging
  hotel: 'hotel',
  motel: 'hotel',
  hostel: 'hostel',
  campground: 'campground',

  // Education
  school: 'school',
  university: 'university',
  college: 'university',
  library: 'library',

  // Recreation
  gym: 'gym',
  fitness_center: 'gym',
  park: 'park',
  playground: 'playground',
  swimming_pool: 'swimming_pool',
  movie_theater: 'cinema',
  cinema: 'cinema',
  museum: 'museum',
  theater: 'theater',
  performing_arts_theater: 'theater',

  // Services
  hair_salon: 'hair_salon',
  beauty_salon: 'hair_salon',
  barber_shop: 'hair_salon',
  laundry: 'laundry',
  laundromat: 'laundry',
  car_repair: 'car_repair',
  auto_repair: 'car_repair',
  car_wash: 'car_wash',

  // Public
  police_station: 'police',
  fire_station: 'fire_station',
  government_office: 'government',
  place_of_worship: 'place_of_worship',
  church: 'place_of_worship',
  mosque: 'place_of_worship',
  synagogue: 'place_of_worship',
  temple: 'place_of_worship',
  cemetery: 'cemetery',

  // Nature
  beach: 'beach',
  mountain: 'mountain',
  viewpoint: 'viewpoint',
};

/**
 * Map an Overture basic_category / categories.primary to a Polaris PlaceCategory.
 * Falls back through taxonomy hierarchy, then to 'other'.
 */
export function mapOvertureCategory(feature: OverturePlace): PlaceCategory {
  const props = feature.properties;

  // Try basic_category first (simplest, most accurate)
  if (props.basic_category && CATEGORY_MAP[props.basic_category]) {
    return CATEGORY_MAP[props.basic_category];
  }

  // Try categories.primary
  if (props.categories?.primary && CATEGORY_MAP[props.categories.primary]) {
    return CATEGORY_MAP[props.categories.primary];
  }

  // Walk taxonomy hierarchy from specific to broad
  if (props.taxonomy?.hierarchy) {
    for (let i = props.taxonomy.hierarchy.length - 1; i >= 0; i--) {
      const mapped = CATEGORY_MAP[props.taxonomy.hierarchy[i]];
      if (mapped) return mapped;
    }
  }

  // Try taxonomy primary
  if (props.taxonomy?.primary && CATEGORY_MAP[props.taxonomy.primary]) {
    return CATEGORY_MAP[props.taxonomy.primary];
  }

  return 'other';
}

/**
 * Map Overture operating_status to Polaris PlaceStatus.
 */
function mapStatus(status?: string): 'open' | 'closed_temporarily' | 'closed_permanently' {
  switch (status) {
    case 'temporarily_closed':
      return 'closed_temporarily';
    case 'permanently_closed':
      return 'closed_permanently';
    default:
      return 'open';
  }
}

/**
 * Convert a single Overture GeoJSON feature to a Polaris Place.
 * Returns null if the feature lacks required fields.
 */
export function overtureFeatureToPlace(feature: OverturePlace): Place | null {
  const props = feature.properties;
  const name = props.names?.primary;
  if (!name) return null;

  const [lng, lat] = feature.geometry.coordinates;
  if (lat == null || lng == null) return null;

  // Skip low-confidence places
  if (props.confidence != null && props.confidence < 0.5) return null;

  const addr = props.addresses?.[0];
  const now = Math.floor(Date.now() / 1000);

  return {
    uuid: props.id ?? feature.id,
    name,
    category: mapOvertureCategory(feature),
    lat,
    lng,
    geohash8: geohashEncode(lat, lng, 8),
    addressStreet: addr?.freeform ?? undefined,
    addressCity: addr?.locality ?? undefined,
    addressState: addr?.region ?? undefined,
    addressPostcode: addr?.postcode ?? undefined,
    addressCountry: addr?.country ?? undefined,
    phone: props.phones?.[0] ?? undefined,
    website: props.websites?.[0] ?? undefined,
    hours: undefined, // Overture doesn't include opening hours
    brandWikidata: props.brand?.wikidata ?? undefined,
    avgRating: undefined,
    reviewCount: 0,
    status: mapStatus(props.operating_status),
    source: 'overture',
    authorPubkey: '',
    signature: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// SQLite upsert
// ---------------------------------------------------------------------------

async function upsertOverturePlaces(places: Place[]): Promise<void> {
  const db = await getDatabase();

  // Batch insert/update in a transaction
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const p of places) {
      await txn.runAsync(
        `INSERT INTO places (
          uuid, name, category, lat, lng, geohash8,
          address_street, address_city, address_state, address_postcode, address_country,
          phone, website, hours, avg_rating, review_count,
          status, source, author_pubkey, signature, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uuid) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          address_street = COALESCE(excluded.address_street, places.address_street),
          address_city = COALESCE(excluded.address_city, places.address_city),
          address_state = COALESCE(excluded.address_state, places.address_state),
          address_postcode = COALESCE(excluded.address_postcode, places.address_postcode),
          address_country = COALESCE(excluded.address_country, places.address_country),
          phone = COALESCE(excluded.phone, places.phone),
          website = COALESCE(excluded.website, places.website),
          status = excluded.status,
          updated_at = excluded.updated_at`,
        [
          p.uuid,
          p.name,
          p.category,
          p.lat,
          p.lng,
          p.geohash8,
          p.addressStreet ?? null,
          p.addressCity ?? null,
          p.addressState ?? null,
          p.addressPostcode ?? null,
          p.addressCountry ?? null,
          p.phone ?? null,
          p.website ?? null,
          p.hours ?? null,
          p.avgRating ?? null,
          p.reviewCount ?? 0,
          p.status,
          p.source,
          p.authorPubkey,
          p.signature,
          p.createdAt,
          p.updatedAt,
        ],
      );
    }
  });
}
