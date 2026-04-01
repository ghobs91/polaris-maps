import type { PlaceCategory } from '../../models/poi';
import type { OsmPoi } from './osmFetcher';
import { searchPlacesByCategory } from './poiService';
import { fetchOsmPoisByTags } from './osmFetcher';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';
import {
  resolveSearchCategories,
  categoryToOverpassTags,
  extractCuisineHint,
} from './categoryResolver';

/** Minimum local results before triggering an Overpass fallback. */
const LOCAL_SUFFICIENCY_THRESHOLD = 5;

/** Nominatim search terms for each PlaceCategory */
const CATEGORY_NOMINATIM_QUERY: Partial<Record<PlaceCategory, string>> = {
  restaurant: 'restaurant',
  cafe: 'cafe coffee',
  bar: 'bar pub',
  bakery: 'bakery',
  fast_food: 'fast food',
  deli: 'deli delicatessen sandwich',
  grocery: 'grocery',
  supermarket: 'supermarket',
  convenience: 'convenience store',
  pharmacy: 'pharmacy',
  hospital: 'hospital',
  clinic: 'clinic doctor',
  dentist: 'dentist',
  bank: 'bank',
  atm: 'atm',
  post_office: 'post office',
  gas_station: 'gas station fuel',
  ev_charging: 'ev charging station',
  parking: 'parking',
  hotel: 'hotel motel',
  hostel: 'hostel',
  campground: 'campground',
  school: 'school',
  university: 'university college',
  library: 'library',
  gym: 'gym fitness',
  park: 'park',
  cinema: 'cinema movie theater',
  museum: 'museum',
  theater: 'theater theatre',
  hair_salon: 'hair salon barber',
  laundry: 'laundry',
  car_repair: 'car repair auto mechanic',
  police: 'police station',
  fire_station: 'fire station',
  place_of_worship: 'church mosque temple synagogue',
  airport: 'airport',
  bus_station: 'bus station',
  train_station: 'train station',
};

export interface CategorySearchResult {
  /** Resolved categories the query was mapped to */
  categories: PlaceCategory[];
  /** All POIs found, deduplicated (local-first, then Overpass backfill) */
  pois: OsmPoi[];
  /** Whether local Overture data was the primary source */
  localPrimary: boolean;
}

/**
 * Search for POIs by natural-language query within a bounding box.
 *
 * Strategy:
 * 1. Resolve the query to PlaceCategory values via the category resolver.
 * 2. Query the local SQLite places table (pre-processed Overture data).
 * 3. If local results are below `LOCAL_SUFFICIENCY_THRESHOLD`, use Overpass
 *    API as a fallback to fill in the remaining POIs.
 * 4. Deduplicate across both sources (local wins on conflicts).
 *
 * Returns null when the query doesn't match any known category —
 * the caller should treat it as a free-text / address search instead.
 */
export async function searchByCategory(
  query: string,
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number = 50,
): Promise<CategorySearchResult | null> {
  const categories = resolveSearchCategories(query);
  if (!categories) return null;

  // Extract cuisine hint for refined searches (e.g. "chinese" from "chinese food")
  const cuisineHint = extractCuisineHint(query);

  // Step 1: Local Overture data (fast, offline-capable)
  const localPlaces = await searchPlacesByCategory(categories, south, west, north, east, limit);

  let localPois = localPlaces.map(placeToOsmPoi);

  // When a specific cuisine/food type is requested, filter & rank local
  // results by relevance so generic restaurants don't drown out matches.
  if (cuisineHint) {
    localPois = rankByCuisineRelevance(localPois, cuisineHint);
  }

  const localPrimary = localPois.length >= LOCAL_SUFFICIENCY_THRESHOLD;

  if (localPrimary) {
    return { categories, pois: localPois.slice(0, limit), localPrimary: true };
  }

  // Step 2: Overpass fallback — build tag pairs for all resolved categories
  const allTags = categories.flatMap(categoryToOverpassTags);

  // When a cuisine hint exists, first try a narrow query with cuisine= ANDed
  // onto each tag pair. If that yields nothing, retry without the AND filter.
  let overpassPois: OsmPoi[] = [];
  try {
    if (cuisineHint) {
      overpassPois = await fetchOsmPoisByTags(south, west, north, east, allTags, [
        ['cuisine', cuisineHint],
      ]);
    }
    // Broaden to all category results if narrow query was empty or no hint
    if (overpassPois.length === 0) {
      overpassPois = await fetchOsmPoisByTags(south, west, north, east, allTags);
      if (cuisineHint) {
        overpassPois = rankByCuisineRelevance(overpassPois, cuisineHint);
      }
    }
  } catch {
    // Overpass unavailable — try Nominatim next
  }

  if (overpassPois.length > 0) {
    const merged = deduplicateCategoryResults(localPois, overpassPois);
    return { categories, pois: merged.slice(0, limit), localPrimary: false };
  }

  // Step 3: Nominatim fallback — query with cuisine-specific or category terms + viewbox
  let nominatimPois: OsmPoi[] = [];
  try {
    nominatimPois = await fetchNominatimPois(
      categories,
      south,
      west,
      north,
      east,
      limit,
      cuisineHint,
    );
  } catch {
    // Nominatim also failed — return whatever local data we have
  }

  // Step 4: Merge — local takes priority for deduplication
  const merged = deduplicateCategoryResults(localPois, nominatimPois);

  return {
    categories,
    pois: merged.slice(0, limit),
    localPrimary: false,
  };
}

/** ~30 m threshold for deduplication */
const DEDUP_THRESHOLD_DEG = 0.0003;

/**
 * Score a POI's relevance to a cuisine keyword.
 * Higher = more relevant.  0 = no match at all.
 */
function cuisineRelevanceScore(poi: OsmPoi, cuisine: string): number {
  const lowerCuisine = cuisine.toLowerCase();
  const name = poi.name.toLowerCase();
  const cuisineTag = (poi.tags.cuisine ?? '').toLowerCase();
  const subtypeTag = (poi.subtype ?? '').toLowerCase();

  // Direct cuisine tag match is the strongest signal
  if (cuisineTag.includes(lowerCuisine)) return 3;
  // Name contains the keyword (e.g. "Joe's Pizza" for "pizza")
  if (name.includes(lowerCuisine)) return 2;
  // Subtype match (e.g. subtype "pizza" in some OSM data)
  if (subtypeTag.includes(lowerCuisine)) return 1;

  return 0;
}

/**
 * Rank POIs by relevance to a specific cuisine keyword.
 * Matching POIs come first (sorted by score), followed by non-matching ones.
 */
function rankByCuisineRelevance(pois: OsmPoi[], cuisine: string): OsmPoi[] {
  return [...pois].sort(
    (a, b) => cuisineRelevanceScore(b, cuisine) - cuisineRelevanceScore(a, cuisine),
  );
}

function deduplicateCategoryResults(primary: OsmPoi[], secondary: OsmPoi[]): OsmPoi[] {
  const result = [...primary];

  for (const poi of secondary) {
    const isDup = result.some(
      (existing) =>
        Math.abs(existing.lat - poi.lat) < DEDUP_THRESHOLD_DEG &&
        Math.abs(existing.lng - poi.lng) < DEDUP_THRESHOLD_DEG &&
        existing.name.toLowerCase() === poi.name.toLowerCase(),
    );
    if (!isDup) result.push(poi);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Nominatim POI Search (fallback when Overpass is unavailable)
// ---------------------------------------------------------------------------

interface NominatimSearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  class: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    road?: string;
  };
}

/**
 * Search Nominatim for POIs by category within a bounded viewbox.
 * This is used as a last-resort fallback when Overpass API is unavailable.
 */
async function fetchNominatimPois(
  categories: PlaceCategory[],
  south: number,
  west: number,
  north: number,
  east: number,
  limit: number,
  cuisineHint?: string | null,
): Promise<OsmPoi[]> {
  // When a cuisine hint is present, use it as the primary search term
  // (e.g. "chinese restaurant" instead of just "restaurant")
  let queryTerms: string;
  if (cuisineHint) {
    queryTerms = `${cuisineHint} restaurant`;
  } else {
    // Use the first category's Nominatim term — joining all terms into one
    // query confuses Nominatim's free-text parser (e.g. "cafe coffee" matches
    // place names instead of amenity types).
    const primaryCategory = categories[0];
    queryTerms = CATEGORY_NOMINATIM_QUERY[primaryCategory] ?? primaryCategory.replace(/_/g, ' ');
  }

  // First try a strictly bounded search within the viewbox
  let pois = await fetchNominatimPoiSingle(queryTerms, west, north, east, south, limit, true);
  if (pois.length > 0) return pois;

  // Retry without strict bounding — viewbox acts as a preference/bias so
  // Nominatim can return nearby POIs that may be just outside the box.
  pois = await fetchNominatimPoiSingle(queryTerms, west, north, east, south, limit, false);
  return pois;
}

/** POI-class values we accept from Nominatim (filters out admin boundaries). */
const POI_CLASSES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft']);

/** Single Nominatim search request, filtered to POI-class results. */
async function fetchNominatimPoiSingle(
  queryTerms: string,
  west: number,
  north: number,
  east: number,
  south: number,
  limit: number,
  bounded: boolean,
): Promise<OsmPoi[]> {
  const params = new URLSearchParams({
    q: queryTerms,
    format: 'jsonv2',
    viewbox: `${west},${north},${east},${south}`,
    bounded: bounded ? '1' : '0',
    limit: String(Math.min(limit, 50)),
    addressdetails: '1',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'PolarisMaps/1.0',
      Accept: 'application/json',
    },
  });

  if (!response.ok) return [];

  const data: NominatimSearchResult[] = await response.json();

  return data
    .filter((item) => {
      if (!POI_CLASSES.has(item.class)) return false;
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      return !isNaN(lat) && !isNaN(lng);
    })
    .map((item) => {
      // Extract a short name from display_name (first part before the first comma)
      const shortName = item.display_name.split(',')[0].trim();
      return {
        id: item.place_id,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        name: shortName,
        type: item.class,
        subtype: item.type,
        tags: {
          [item.class]: item.type,
          name: shortName,
          ...(item.address?.road ? { 'addr:street': item.address.road } : {}),
          ...((item.address?.city ?? item.address?.town ?? item.address?.village)
            ? { 'addr:city': (item.address?.city ?? item.address?.town ?? item.address?.village)! }
            : {}),
        },
      };
    });
}
