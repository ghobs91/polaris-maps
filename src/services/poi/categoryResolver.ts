import type { PlaceCategory } from '../../models/poi';

/**
 * Maps natural language search queries to Polaris PlaceCategory values.
 * Returns null when the query doesn't match a known category — indicating
 * it should be treated as a free-text / address search instead.
 */

const QUERY_TO_CATEGORIES: Record<string, PlaceCategory[]> = {
  // Coffee / Café
  coffee: ['cafe'],
  coffeeshop: ['cafe'],
  coffeeshops: ['cafe'],
  'coffee shop': ['cafe'],
  'coffee shops': ['cafe'],
  cafe: ['cafe'],
  cafes: ['cafe'],
  café: ['cafe'],
  cafés: ['cafe'],
  'tea house': ['cafe'],
  tea: ['cafe'],
  espresso: ['cafe'],
  latte: ['cafe'],
  cappuccino: ['cafe'],

  // Restaurants / Food
  restaurant: ['restaurant'],
  restaurants: ['restaurant'],
  food: ['restaurant', 'fast_food', 'cafe', 'bakery'],
  'places to eat': ['restaurant', 'fast_food', 'cafe'],
  dining: ['restaurant'],
  dine: ['restaurant'],
  eat: ['restaurant', 'fast_food'],
  lunch: ['restaurant', 'fast_food'],
  dinner: ['restaurant'],
  breakfast: ['restaurant', 'cafe', 'bakery'],
  brunch: ['restaurant', 'cafe'],
  pizza: ['restaurant'],
  sushi: ['restaurant'],
  burger: ['restaurant', 'fast_food'],
  burgers: ['restaurant', 'fast_food'],
  steak: ['restaurant'],
  seafood: ['restaurant'],

  // Cuisine-specific searches
  'chinese food': ['restaurant'],
  'chinese restaurant': ['restaurant'],
  'chinese restaurants': ['restaurant'],
  chinese: ['restaurant'],
  'mexican food': ['restaurant'],
  'mexican restaurant': ['restaurant'],
  mexican: ['restaurant'],
  'italian food': ['restaurant'],
  'italian restaurant': ['restaurant'],
  italian: ['restaurant'],
  'japanese food': ['restaurant'],
  'japanese restaurant': ['restaurant'],
  japanese: ['restaurant'],
  'thai food': ['restaurant'],
  'thai restaurant': ['restaurant'],
  thai: ['restaurant'],
  'indian food': ['restaurant'],
  'indian restaurant': ['restaurant'],
  indian: ['restaurant'],
  'korean food': ['restaurant'],
  'korean restaurant': ['restaurant'],
  korean: ['restaurant'],
  'vietnamese food': ['restaurant'],
  'vietnamese restaurant': ['restaurant'],
  vietnamese: ['restaurant'],
  'greek food': ['restaurant'],
  'greek restaurant': ['restaurant'],
  greek: ['restaurant'],
  'french food': ['restaurant'],
  'french restaurant': ['restaurant'],
  french: ['restaurant'],
  'mediterranean food': ['restaurant'],
  mediterranean: ['restaurant'],
  'middle eastern food': ['restaurant'],
  'middle eastern': ['restaurant'],
  'american food': ['restaurant', 'fast_food'],
  american: ['restaurant', 'fast_food'],
  ramen: ['restaurant'],
  pho: ['restaurant'],
  tacos: ['restaurant', 'fast_food'],
  taco: ['restaurant', 'fast_food'],
  curry: ['restaurant'],
  bbq: ['restaurant'],
  barbecue: ['restaurant'],
  wings: ['restaurant', 'fast_food'],
  noodles: ['restaurant'],
  dumplings: ['restaurant'],
  dim_sum: ['restaurant'],
  'dim sum': ['restaurant'],

  'fast food': ['fast_food'],
  'fast-food': ['fast_food'],
  fastfood: ['fast_food'],

  // Bars / Nightlife
  bar: ['bar'],
  bars: ['bar'],
  pub: ['bar'],
  pubs: ['bar'],
  beer: ['bar'],
  brewery: ['bar'],
  cocktail: ['bar'],
  cocktails: ['bar'],
  drinks: ['bar'],
  nightlife: ['bar'],
  wine: ['bar'],

  // Bakery
  bakery: ['bakery'],
  bakeries: ['bakery'],
  bread: ['bakery'],
  pastry: ['bakery'],
  pastries: ['bakery'],

  // Shopping — Groceries
  grocery: ['grocery', 'supermarket'],
  groceries: ['grocery', 'supermarket'],
  supermarket: ['supermarket'],
  supermarkets: ['supermarket'],
  'grocery store': ['grocery', 'supermarket'],
  'convenience store': ['convenience'],
  convenience: ['convenience'],

  // Shopping — General
  shopping: ['clothing', 'electronics', 'hardware', 'bookstore'],
  clothing: ['clothing'],
  clothes: ['clothing'],
  fashion: ['clothing'],
  electronics: ['electronics'],
  hardware: ['hardware'],
  bookstore: ['bookstore'],
  bookstores: ['bookstore'],
  books: ['bookstore'],

  // Health
  pharmacy: ['pharmacy'],
  pharmacies: ['pharmacy'],
  drugstore: ['pharmacy'],
  hospital: ['hospital'],
  hospitals: ['hospital'],
  'emergency room': ['hospital'],
  er: ['hospital'],
  clinic: ['clinic'],
  clinics: ['clinic'],
  doctor: ['clinic'],
  doctors: ['clinic'],
  dentist: ['dentist'],
  dentists: ['dentist'],

  // Finance
  bank: ['bank'],
  banks: ['bank'],
  atm: ['atm'],
  atms: ['atm'],
  'post office': ['post_office'],

  // Transport
  gas: ['gas_station'],
  'gas station': ['gas_station'],
  'gas stations': ['gas_station'],
  fuel: ['gas_station'],
  petrol: ['gas_station'],
  'ev charging': ['ev_charging'],
  'ev charger': ['ev_charging'],
  'charging station': ['ev_charging'],
  parking: ['parking'],

  // Lodging
  hotel: ['hotel'],
  hotels: ['hotel'],
  motel: ['hotel'],
  hostel: ['hostel'],
  hostels: ['hostel'],
  campground: ['campground'],
  camping: ['campground'],

  // Education
  school: ['school'],
  schools: ['school'],
  university: ['university'],
  universities: ['university'],
  college: ['university'],
  library: ['library'],
  libraries: ['library'],

  // Recreation
  gym: ['gym'],
  gyms: ['gym'],
  fitness: ['gym'],
  'fitness center': ['gym'],
  workout: ['gym'],
  park: ['park'],
  parks: ['park'],
  playground: ['playground'],
  playgrounds: ['playground'],
  pool: ['swimming_pool'],
  'swimming pool': ['swimming_pool'],
  cinema: ['cinema'],
  movie: ['cinema'],
  movies: ['cinema'],
  'movie theater': ['cinema'],
  museum: ['museum'],
  museums: ['museum'],
  theater: ['theater'],
  theatre: ['theater'],

  // Services
  'hair salon': ['hair_salon'],
  haircut: ['hair_salon'],
  barber: ['hair_salon'],
  laundry: ['laundry'],
  laundromat: ['laundry'],
  'car repair': ['car_repair'],
  'auto repair': ['car_repair'],
  mechanic: ['car_repair'],
  'car wash': ['car_wash'],

  // Public
  police: ['police'],
  'police station': ['police'],
  'fire station': ['fire_station'],
  church: ['place_of_worship'],
  mosque: ['place_of_worship'],
  synagogue: ['place_of_worship'],
  temple: ['place_of_worship'],
  'place of worship': ['place_of_worship'],

  // Transport hubs
  airport: ['airport'],
  'bus station': ['bus_station'],
  'bus stop': ['bus_station'],
  'train station': ['train_station'],
  subway: ['train_station'],
  metro: ['train_station'],

  // Nature
  beach: ['beach'],
  beaches: ['beach'],
  mountain: ['mountain'],
  viewpoint: ['viewpoint'],
  'scenic view': ['viewpoint'],
};

/**
 * Resolve a user search query to one or more PlaceCategory values.
 * Returns null if the query doesn't match any known category.
 *
 * Matching is case-insensitive and works on the full query string as well
 * as individual words, preferring exact full-query matches.
 */
/**
 * Known cuisine keywords — when the query contains one of these, it acts as
 * a hint to refine Nominatim / Overpass searches by cuisine.
 */
const CUISINE_KEYWORDS: Record<string, string> = {
  chinese: 'chinese',
  mexican: 'mexican',
  italian: 'italian',
  japanese: 'japanese',
  thai: 'thai',
  indian: 'indian',
  korean: 'korean',
  vietnamese: 'vietnamese',
  greek: 'greek',
  french: 'french',
  mediterranean: 'mediterranean',
  'middle eastern': 'middle_eastern',
  american: 'american',
  ramen: 'ramen',
  pho: 'vietnamese',
  tacos: 'mexican',
  taco: 'mexican',
  curry: 'indian',
  bbq: 'bbq',
  barbecue: 'bbq',
  sushi: 'sushi',
  pizza: 'pizza',
  burger: 'burger',
  burgers: 'burger',
  noodles: 'noodles',
  dumplings: 'chinese',
  'dim sum': 'chinese',
  wings: 'wings',
  seafood: 'seafood',
  steak: 'steak',
};

/**
 * Extract a cuisine hint from a search query, or null if not cuisine-specific.
 */
export function extractCuisineHint(query: string): string | null {
  const normalized = query.trim().toLowerCase();
  // Check multi-word keys first (e.g. "middle eastern")
  for (const [keyword, cuisine] of Object.entries(CUISINE_KEYWORDS)) {
    if (normalized.includes(keyword)) return cuisine;
  }
  return null;
}

export function resolveSearchCategories(query: string): PlaceCategory[] | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  // Exact match on full query
  const exact = QUERY_TO_CATEGORIES[normalized];
  if (exact) return exact;

  // Try removing trailing 's' for simple plurals
  if (normalized.endsWith('s')) {
    const singular = QUERY_TO_CATEGORIES[normalized.slice(0, -1)];
    if (singular) return singular;
  }

  // Try each word individually and collect unique categories
  const words = normalized.split(/\s+/);
  if (words.length > 1) {
    const found = new Set<PlaceCategory>();
    for (const word of words) {
      const cats = QUERY_TO_CATEGORIES[word];
      if (cats) cats.forEach((c) => found.add(c));
    }
    if (found.size > 0) return [...found];
  }

  return null;
}

/**
 * Map a PlaceCategory to Overpass QL tag filters.
 * Returns an array of `["key", "value"]` pairs for Overpass API queries.
 */
export function categoryToOverpassTags(category: PlaceCategory): Array<[string, string]> {
  const mapping: Record<string, Array<[string, string]>> = {
    restaurant: [['amenity', 'restaurant']],
    cafe: [
      ['amenity', 'cafe'],
      ['shop', 'coffee'],
    ],
    bar: [
      ['amenity', 'bar'],
      ['amenity', 'pub'],
    ],
    bakery: [['shop', 'bakery']],
    fast_food: [['amenity', 'fast_food']],
    grocery: [
      ['shop', 'greengrocer'],
      ['shop', 'grocery'],
    ],
    supermarket: [['shop', 'supermarket']],
    convenience: [['shop', 'convenience']],
    pharmacy: [['amenity', 'pharmacy']],
    hospital: [['amenity', 'hospital']],
    clinic: [
      ['amenity', 'clinic'],
      ['amenity', 'doctors'],
    ],
    dentist: [['amenity', 'dentist']],
    bank: [['amenity', 'bank']],
    atm: [['amenity', 'atm']],
    post_office: [['amenity', 'post_office']],
    gas_station: [['amenity', 'fuel']],
    ev_charging: [['amenity', 'charging_station']],
    parking: [['amenity', 'parking']],
    hotel: [
      ['tourism', 'hotel'],
      ['tourism', 'motel'],
    ],
    hostel: [['tourism', 'hostel']],
    campground: [['tourism', 'camp_site']],
    school: [['amenity', 'school']],
    university: [
      ['amenity', 'university'],
      ['amenity', 'college'],
    ],
    library: [['amenity', 'library']],
    gym: [
      ['leisure', 'fitness_centre'],
      ['leisure', 'sports_centre'],
    ],
    park: [['leisure', 'park']],
    playground: [['leisure', 'playground']],
    swimming_pool: [['leisure', 'swimming_pool']],
    cinema: [['amenity', 'cinema']],
    museum: [['tourism', 'museum']],
    theater: [['amenity', 'theatre']],
    clothing: [['shop', 'clothes']],
    electronics: [['shop', 'electronics']],
    hardware: [
      ['shop', 'hardware'],
      ['shop', 'doityourself'],
    ],
    bookstore: [['shop', 'books']],
    hair_salon: [
      ['shop', 'hairdresser'],
      ['shop', 'beauty'],
    ],
    laundry: [['shop', 'laundry']],
    car_repair: [['shop', 'car_repair']],
    car_wash: [['amenity', 'car_wash']],
    police: [['amenity', 'police']],
    fire_station: [['amenity', 'fire_station']],
    government: [['amenity', 'townhall']],
    place_of_worship: [['amenity', 'place_of_worship']],
    cemetery: [
      ['amenity', 'grave_yard'],
      ['landuse', 'cemetery'],
    ],
    airport: [['aeroway', 'aerodrome']],
    bus_station: [
      ['amenity', 'bus_station'],
      ['highway', 'bus_stop'],
    ],
    train_station: [['railway', 'station']],
    beach: [['natural', 'beach']],
    mountain: [['natural', 'peak']],
    viewpoint: [['tourism', 'viewpoint']],
  };

  return mapping[category] ?? [['amenity', category]];
}
