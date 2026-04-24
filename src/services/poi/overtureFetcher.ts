import { getDatabase } from '../database/init';
import { encode as geohashEncode } from '../../utils/geohash';
import { OVERTURE_PLACES_URL } from '../../constants/config';
import type { Place, PlaceCategory } from '../../models/poi';
import type { OverturePlace, OverturePlaceCollection } from '../../types/overture';
import type { SQLiteBindValue } from 'expo-sqlite';

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
  deli: 'deli',
  delicatessen: 'deli',
  sandwich_shop: 'deli',
  bagel_shop: 'deli',
  ice_cream_shop: 'cafe',

  // Shopping
  grocery_store: 'grocery',
  supermarket: 'supermarket',
  convenience_store: 'convenience',
  clothing_store: 'clothing',
  electronics_store: 'electronics',
  hardware_store: 'hardware',
  bookstore: 'bookstore',
  book_store: 'bookstore',
  florist: 'other',
  furniture_store: 'other',
  jewelry_store: 'other',
  pet_store: 'other',
  sporting_goods_store: 'other',
  toy_store: 'other',
  variety_store: 'other',
  department_store: 'other',
  discount_store: 'other',
  home_goods_store: 'other',
  office_supply_store: 'other',
  pawn_shop: 'other',
  thrift_store: 'other',
  vape_shop: 'other',
  tobacco_shop: 'other',
  liquor_store: 'other',
  candy_store: 'other',
  cheese_shop: 'other',
  chocolate_shop: 'other',
  coffee_store: 'cafe',
  craft_store: 'other',
  fabric_store: 'other',
  fishing_store: 'other',
  garden_center: 'other',
  gift_shop: 'other',
  gun_shop: 'other',
  hobby_shop: 'other',
  kitchen_store: 'other',
  luggage_store: 'other',
  mattress_store: 'other',
  music_store: 'other',
  outdoor_store: 'other',
  paint_store: 'other',
  party_store: 'other',
  perfume_store: 'other',
  pool_store: 'other',
  rug_store: 'other',
  sewing_shop: 'other',
  shoe_store: 'clothing',
  spa: 'hair_salon',
  supplement_store: 'other',
  surf_shop: 'other',
  tailor: 'other',
  tile_store: 'other',
  trophy_shop: 'other',
  uniform_store: 'clothing',
  vitamin_store: 'other',
  watch_store: 'other',
  wine_store: 'other',

  // Health
  pharmacy: 'pharmacy',
  drugstore: 'pharmacy',
  hospital: 'hospital',
  medical_center: 'hospital',
  clinic: 'clinic',
  doctor: 'clinic',
  dentist: 'dentist',
  chiropractor: 'clinic',
  optometrist: 'clinic',
  physical_therapist: 'clinic',
  psychologist: 'clinic',
  surgeon: 'clinic',
  urgent_care: 'clinic',
  veterinary_clinic: 'other',
  acupuncture: 'clinic',
  allergist: 'clinic',
  cardiologist: 'clinic',
  dermatologist: 'clinic',
  endocrinologist: 'clinic',
  gastroenterologist: 'clinic',
  general_practitioner: 'clinic',
  gynecologist: 'clinic',
  hematologist: 'clinic',
  immunologist: 'clinic',
  neurologist: 'clinic',
  oncologist: 'clinic',
  ophthalmologist: 'clinic',
  orthopedic_surgeon: 'clinic',
  otolaryngologist: 'clinic',
  pediatrician: 'clinic',
  podiatrist: 'clinic',
  psychiatrist: 'clinic',
  pulmonologist: 'clinic',
  radiologist: 'clinic',
  rheumatologist: 'clinic',
  urologist: 'clinic',

  // Finance
  bank: 'bank',
  atm: 'atm',
  post_office: 'post_office',
  accountant: 'other',
  financial_planner: 'other',
  insurance_agency: 'other',
  loan_agency: 'other',
  tax_preparation: 'other',
  investment_service: 'other',
  mortgage_broker: 'other',
  credit_union: 'bank',

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
  car_dealer: 'other',
  car_rental: 'other',
  taxi_stand: 'other',
  bicycle_shop: 'other',
  motorcycle_dealer: 'other',
  truck_dealer: 'other',
  boat_dealer: 'other',
  rv_dealer: 'other',

  // Lodging
  hotel: 'hotel',
  motel: 'hotel',
  hostel: 'hostel',
  campground: 'campground',
  bed_and_breakfast: 'hotel',
  resort: 'hotel',
  apartment_building: 'other',
  condominium: 'other',

  // Education
  school: 'school',
  university: 'university',
  college: 'university',
  library: 'library',
  preschool: 'school',
  kindergarten: 'school',
  elementary_school: 'school',
  middle_school: 'school',
  high_school: 'school',
  language_school: 'school',
  driving_school: 'school',
  tutoring_service: 'school',
  music_school: 'school',
  art_school: 'school',
  dance_school: 'school',
  trade_school: 'school',
  vocational_school: 'school',

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
  sports_club: 'gym',
  yoga_studio: 'gym',
  pilates_studio: 'gym',
  martial_arts_school: 'gym',
  dance_studio: 'gym',
  bowling_alley: 'other',
  golf_course: 'other',
  tennis_club: 'other',
  skate_park: 'park',
  dog_park: 'park',
  community_center: 'other',
  recreation_center: 'other',
  arcade: 'other',
  amusement_park: 'other',
  aquarium: 'other',
  zoo: 'other',
  botanical_garden: 'park',
  nature_reserve: 'park',
  trail: 'park',
  beach: 'beach',
  mountain: 'mountain',
  viewpoint: 'viewpoint',
  observatory: 'other',
  planetarium: 'other',
  science_center: 'museum',
  art_gallery: 'museum',
  cultural_center: 'other',
  historical_landmark: 'other',
  monument: 'other',
  memorial: 'other',
  stadium: 'other',
  arena: 'other',
  racetrack: 'other',
  ski_resort: 'other',
  water_park: 'swimming_pool',

  // Services
  hair_salon: 'hair_salon',
  beauty_salon: 'hair_salon',
  barber_shop: 'hair_salon',
  laundry: 'laundry',
  laundromat: 'laundry',
  car_repair: 'car_repair',
  auto_repair: 'car_repair',
  car_wash: 'car_wash',
  nail_salon: 'hair_salon',
  spa_and_salon: 'hair_salon',
  day_spa: 'hair_salon',
  massage: 'hair_salon',
  tattoo_parlor: 'other',
  piercing_shop: 'other',
  tanning_salon: 'hair_salon',
  weight_loss_center: 'gym',
  counseling_service: 'other',
  employment_agency: 'other',
  event_planner: 'other',
  funeral_home: 'other',
  graphic_designer: 'other',
  interior_designer: 'other',
  lawyer: 'other',
  locksmith: 'other',
  moving_company: 'other',
  photographer: 'other',
  plumber: 'other',
  real_estate_agency: 'other',
  security_service: 'other',
  storage_facility: 'other',
  travel_agency: 'other',
  web_designer: 'other',
  wedding_planner: 'other',
  electrician: 'other',
  hvac_contractor: 'other',
  painter: 'other',
  roofer: 'other',
  carpenter: 'other',
  cleaning_service: 'other',
  pest_control: 'other',
  pool_service: 'other',
  tree_service: 'other',
  window_cleaning: 'other',

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
  courthouse: 'government',
  city_hall: 'government',
  embassy: 'government',
  town_hall: 'government',
  public_bath: 'other',
  public_building: 'government',

  // Professional services
  advertising_agency: 'other',
  architectural_firm: 'other',
  consulting: 'other',
  engineering_firm: 'other',
  law_firm: 'other',
  marketing_agency: 'other',
  medical_office: 'clinic',
  notary: 'other',
  office: 'other',
  research_institute: 'other',
  software_company: 'other',
  translation_service: 'other',
  veterinary_service: 'other',

  // Food service
  catering: 'restaurant',
  food_court: 'restaurant',
  food_truck: 'fast_food',
  kitchen: 'restaurant',
  meal_delivery: 'restaurant',
  meal_takeaway: 'fast_food',
  restaurant_supply_store: 'other',

  // Other
  adult_entertainment: 'other',
  aquarium_shop: 'other',
  atm_lobby: 'atm',
  bail_bondsman: 'other',
  bank_equipment: 'other',
  bar_and_grill: 'bar',
  basement: 'other',
  beach_pavilion: 'other',
  bed_shop: 'other',
  beer_garden: 'bar',
  beer_store: 'other',
  bicycle_parking: 'parking',
  bicycle_rental: 'other',
  bistro: 'restaurant',
  blood_bank: 'hospital',
  boat_ramp: 'other',
  boat_storage: 'other',
  bookmaker: 'other',
  boot_camp: 'gym',
  brothel: 'other',
  buddhist_temple: 'place_of_worship',
  buffet: 'restaurant',
  building: 'other',
  butcher: 'other',
  cabin: 'other',
  cafe_ice_cream: 'cafe',
  camp_site: 'campground',
  car_sharing: 'other',
  caravan_site: 'campground',
  casino: 'other',
  castle: 'other',
  chalet: 'other',
  charity: 'other',
  childcare: 'other',
  childrens_cafe: 'cafe',
  church_cathedral: 'place_of_worship',
  clinic_urgent_care: 'clinic',
  clock: 'other',
  club: 'bar',
  coffee: 'cafe',
  college_arts: 'university',
  college_business: 'university',
  college_engineering: 'university',
  college_law: 'university',
  college_library: 'library',
  college_medical: 'university',
  college_public: 'university',
  college_science: 'university',
  commercial: 'other',
  communications_tower: 'other',
  community_centre: 'other',
  compact_disc: 'other',
  computer: 'other',
  confectionery: 'other',
  construction_company: 'other',
  consulate: 'government',
  convenience: 'convenience',
  copyshop: 'other',
  crafts: 'other',
  crematorium: 'other',
  cross: 'other',
  cycling: 'other',
  dairy: 'other',
  dance: 'gym',
  dangerous_area: 'other',
  day_care: 'other',
  defibrillator: 'other',
  dell: 'other',
  dentist_orthodontics: 'dentist',
  desert: 'other',
  disco: 'bar',
  dive_centre: 'other',
  doctors: 'clinic',
  dog_walking: 'other',
  drinking_water: 'other',
  driving_range: 'other',
  dry_cleaning: 'laundry',
  e_bike_rental: 'other',
  educational_institution: 'school',
  emergency_phone: 'other',
  energy_supplier: 'other',
  estate_agent: 'other',
  excrement_baskets: 'other',
  exhibition_centre: 'other',
  factory: 'other',
  ferry_terminal: 'other',
  fishing: 'other',
  flea_market: 'other',
  floating_home: 'other',
  fountain: 'other',
  free_flying: 'other',
  fuel: 'gas_station',
  gambling: 'other',
  garage: 'parking',
  garden: 'park',
  gas_canister: 'other',
  gate: 'other',
  generator: 'other',
  geothermal: 'other',
  gift: 'other',
  golf: 'other',
  goods: 'other',
  government: 'government',
  grave_yard: 'cemetery',
  grit_bin: 'other',
  guest_house: 'hotel',
  gymnasium: 'gym',
  hackerspace: 'other',
  hall: 'other',
  hamlet: 'other',
  hangar: 'other',
  health: 'clinic',
  hearing_aids: 'other',
  helipad: 'other',
  hifi: 'other',
  hinduist_temple: 'place_of_worship',
  historical: 'other',
  home_improvement: 'other',
  horse_riding: 'other',
  hospice: 'hospital',
  hotel_chain: 'hotel',
  house: 'other',
  houseboat: 'other',
  hunting_stand: 'other',
  hvac: 'other',
  ice_cream: 'cafe',
  ice_rink: 'other',
  internet_cafe: 'cafe',
  island: 'other',
  jainist_temple: 'place_of_worship',
  jetty: 'other',
  jewelry: 'other',
  jungle: 'other',
  karaoke: 'other',
  kissing: 'other',
  laboratory: 'other',
  lake: 'other',
  land: 'other',
  landfill: 'other',
  layer: 'other',
  leisure: 'other',
  level_crossing: 'other',
  library_public: 'library',
  life_ring: 'other',
  lift_gate: 'other',
  lighting: 'other',
  lighthouse: 'other',
  liquor: 'other',
  listing: 'other',
  lock: 'other',
  lodging: 'hotel',
  log: 'other',
  love_hotel: 'hotel',
  mall: 'other',
  manor: 'other',
  marina: 'other',
  marketplace: 'other',
  mast: 'other',
  meadow: 'other',
  medical: 'clinic',
  military: 'other',
  mine: 'other',
  miniature_golf: 'other',
  mobile_home: 'other',
  money_transfer: 'other',
  monastery: 'place_of_worship',
  motorway_junction: 'other',
  mountain_pass: 'other',
  museum_art: 'museum',
  museum_history: 'museum',
  museum_science: 'museum',
  music: 'other',
  music_venue: 'theater',
  musical_instrument: 'other',
  natural: 'other',
  newsagent: 'other',
  nightclub: 'bar',
  nursing_home: 'hospital',
  nutrition_supplements: 'other',
  nursing: 'hospital',
  oneway: 'other',
  orchard: 'other',
  outdoor: 'other',
  paint: 'other',
  palace: 'other',
  parking_entrance: 'parking',
  parking_space: 'parking',
  park_ride: 'parking',
  peak: 'mountain',
  pedestrian: 'other',
  perfumery: 'other',
  pet: 'other',
  pet_grooming: 'other',
  photo_booth: 'other',
  picnic_site: 'park',
  pier: 'other',
  pipeline: 'other',
  place: 'other',
  plant: 'other',
  plaque: 'other',
  platform: 'other',
  playroom: 'playground',
  pond: 'other',
  pool: 'swimming_pool',
  post_box: 'post_office',
  power_plant: 'other',
  power_substation: 'other',
  power_tower: 'other',
  prison: 'other',
  public_bookcase: 'library',
  quarry: 'other',
  railway: 'train_station',
  ranger_station: 'other',
  rapid: 'other',
  recycling: 'other',
  reef: 'other',
  refugee_camp: 'other',
  religious: 'place_of_worship',
  research: 'other',
  residential: 'other',
  retail: 'other',
  river: 'other',
  rock: 'other',
  roller_coaster: 'other',
  ruins: 'other',
  rural: 'other',
  saddle: 'other',
  salon: 'hair_salon',
  salt_pond: 'other',
  sand: 'other',
  sauna: 'hair_salon',
  scree: 'other',
  scrub: 'other',
  scuba_diving: 'other',
  second_hand: 'other',
  shelter: 'other',
  shoemaker: 'other',
  shop: 'other',
  shower: 'other',
  shrine: 'place_of_worship',
  sink: 'other',
  ski: 'other',
  skin_care: 'hair_salon',
  slaughterhouse: 'other',
  slipway: 'other',
  social_facility: 'other',
  spring: 'other',
  stage: 'other',
  station: 'train_station',
  statue: 'other',
  stone: 'other',
  storage_rental: 'other',
  store: 'other',
  street_lamp: 'other',
  studio: 'other',
  submerged: 'other',
  summit: 'mountain',
  swimming_area: 'swimming_pool',
  swing_gate: 'other',
  tailors: 'other',
  taoist_temple: 'place_of_worship',
  tavern: 'bar',
  tax_advisor: 'other',
  taxi: 'other',
  tea: 'cafe',
  telemarketing: 'other',
  telephone: 'other',
  telescope: 'other',
  tennis: 'other',
  terminal: 'other',
  theme_park: 'other',
  ticket_validator: 'other',
  tidal_channel: 'other',
  tobacco: 'other',
  toilets: 'other',
  toll_booth: 'other',
  tomb: 'cemetery',
  tower: 'other',
  townhall: 'government',
  toys: 'other',
  track: 'other',
  trade: 'other',
  traffic_signals: 'other',
  trail_riding_station: 'other',
  tram_stop: 'bus_station',
  tree: 'other',
  tunnel: 'other',
  urban: 'other',
  valley: 'other',
  vehicle_inspection: 'other',
  veterinary: 'other',
  video: 'other',
  video_games: 'other',
  village: 'other',
  village_green: 'park',
  vineyard: 'other',
  volcano: 'other',
  waste_basket: 'other',
  waste_disposal: 'other',
  waste_transfer_station: 'other',
  water: 'other',
  water_point: 'other',
  water_slide: 'swimming_pool',
  water_tower: 'other',
  waterfall: 'other',
  waterway: 'other',
  waypoint: 'other',
  weather_station: 'other',
  wetland: 'other',
  whale_watching: 'other',
  windmill: 'other',
  works: 'other',
  yoga: 'gym',
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

  // Skip low-confidence places (threshold lowered to capture more businesses
  // in commercial areas where Overture data is rich but confidence varies)
  if (props.confidence != null && props.confidence < 0.3) return null;

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
    socials: props.socials?.length ? props.socials : undefined,
    emails: props.emails?.length ? props.emails : undefined,
    hours: undefined, // Overture doesn't include opening hours
    brandWikidata: props.brand?.wikidata ?? undefined,
    brandName: props.brand?.names?.primary ?? undefined,
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

  // SQLite variable limit is 999. With 25 columns per row, max ~39 rows per statement.
  // Use chunks of 30 rows to stay safely under the limit.
  const CHUNK_SIZE = 30;
  const colCount = 25;
  const colList = `uuid, name, category, lat, lng, geohash8,
          address_street, address_city, address_state, address_postcode, address_country,
          phone, website, social_media, emails, brand_name, hours, avg_rating, review_count,
          status, source, author_pubkey, signature, created_at, updated_at`;

  await db.withExclusiveTransactionAsync(async (txn) => {
    // Temporarily disable FTS triggers during bulk upsert to avoid
    // O(2n) delete+insert FTS index operations per row. We rebuild
    // the FTS index once after the transaction completes.
    await txn.runAsync('DROP TRIGGER IF EXISTS places_fts_insert');
    await txn.runAsync('DROP TRIGGER IF EXISTS places_fts_update');

    for (let i = 0; i < places.length; i += CHUNK_SIZE) {
      const chunk = places.slice(i, i + CHUNK_SIZE);
      const rowPlaceholders = `(${Array(colCount).fill('?').join(', ')})`;
      const placeholders = chunk.map(() => rowPlaceholders).join(', ');
      const params: SQLiteBindValue[] = [];
      for (const p of chunk) {
        params.push(
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
          p.socials?.length ? JSON.stringify(p.socials) : null,
          p.emails?.length ? JSON.stringify(p.emails) : null,
          p.brandName ?? null,
          p.hours ?? null,
          p.avgRating ?? null,
          p.reviewCount ?? 0,
          p.status,
          p.source,
          p.authorPubkey,
          p.signature,
          p.createdAt,
          p.updatedAt,
        );
      }
      await txn.runAsync(
        `INSERT INTO places (${colList}) VALUES ${placeholders}
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
          social_media = COALESCE(excluded.social_media, places.social_media),
          emails = COALESCE(excluded.emails, places.emails),
          brand_name = COALESCE(excluded.brand_name, places.brand_name),
          status = excluded.status,
          updated_at = excluded.updated_at`,
        params,
      );
    }
  });

  // Rebuild FTS index in one pass (faster than per-row trigger updates)
  // then re-create the triggers for single-row inserts/updates.
  await db.execAsync(`INSERT INTO places_fts(places_fts) VALUES('rebuild')`);
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS places_fts_insert AFTER INSERT ON places BEGIN
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;
    CREATE TRIGGER IF NOT EXISTS places_fts_update AFTER UPDATE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END
  `);
}
