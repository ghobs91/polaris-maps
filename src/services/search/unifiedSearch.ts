/**
 * Unified search orchestrator.
 *
 * Replaces the bifurcated "category OR geocoding" flow with a single
 * pipeline that runs multiple search strategies in parallel, merges
 * results, and applies unified relevance scoring.
 *
 * Search sources (in parallel):
 * 1. Local FTS5 — instant, offline, searches places table by name/brand/category
 * 2. Category search — Overpass + Nominatim POI-class search for recognized categories
 * 3. Photon geocoder — fuzzy, typo-tolerant OSM-based search (POIs + addresses)
 * 4. Address geocoding — local FTS5 geocoding_entries + Nominatim fallback
 *
 * Results are deduplicated, scored, and returned in relevance order.
 */

import type { OsmPoi } from '../poi/osmFetcher';
import type { GeocodingResult } from '../geocoding/geocodingService';
import { searchPlacesFts } from '../poi/poiService';
import { searchByCategory } from '../poi/categorySearchService';
import { searchAddress } from '../geocoding/geocodingService';
import { searchPhoton } from './photonGeocoder';
import { parseSearchQuery, fuzzyMatchBrand, isAddressQuery, type ParsedSearchQuery } from './queryParser';
import { fetchOverturePlaces } from '../poi/overtureFetcher';
import { fetchOsmPoisByName } from '../poi/osmFetcher';
import { scoreAndRank, deduplicateResults, type ScoredResult } from './searchRanker';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UnifiedSearchResult {
  /** Display name for the result. */
  name: string;
  /** Subtitle (address, city, category). */
  subtitle: string;
  /** Geographic coordinates. */
  lat: number;
  lng: number;
  /** Result type for icon selection. */
  type: 'poi' | 'address' | 'place';
  /** OSM-style type tag (amenity, shop, etc.) */
  osmType?: string;
  /** OSM-style subtype tag (restaurant, cafe, etc.) */
  osmSubtype?: string;
  /** Relevance score (0–100). */
  score: number;
  /** Distance from reference point in km. */
  distanceKm: number;
  /** Original POI data if available. */
  poi?: OsmPoi;
  /** Brand name if matched. */
  brand?: string;
  /** Address city. */
  city?: string;
}

export interface SearchOptions {
  /** Viewport center latitude. */
  lat: number;
  /** Viewport center longitude. */
  lng: number;
  /** Current zoom level. */
  zoom: number;
  /** Maximum results to return. */
  limit?: number;
  /** Actual visible viewport bounds for in-viewport boosting. */
  viewportBounds?: { south: number; north: number; west: number; east: number };
}

/**
 * Execute a unified search across all available sources.
 */
export async function unifiedSearch(
  query: string,
  options: SearchOptions,
): Promise<UnifiedSearchResult[]> {
  if (query.trim().length < 2) return [];

  const { lat, lng, zoom, limit = 30 } = options;

  // Category → OSM tag mapping for Photon filtering
  const CATEGORY_TO_OSM_TAG: Partial<Record<string, string>> = {
    cafe: 'amenity:cafe', restaurant: 'amenity:restaurant', fast_food: 'amenity:fast_food',
    bar: 'amenity:bar', pharmacy: 'amenity:pharmacy', hospital: 'amenity:hospital',
    fuel: 'amenity:fuel', parking: 'amenity:parking', supermarket: 'shop:supermarket',
    hotel: 'tourism:hotel', atm: 'amenity:atm', bank: 'amenity:bank',
    gym: 'leisure:fitness_centre',
  };

  // 1. Parse the query into structured intent
  const parsed = parseSearchQuery(query);

  // Also check for fuzzy brand matches (handles typos like "starbuks")
  if (!parsed.brand) {
    const fuzzyBrand = fuzzyMatchBrand(query);
    if (fuzzyBrand) parsed.brand = fuzzyBrand;
  }

  // Detect address queries early — these need fundamentally different handling
  const addressQuery = isAddressQuery(query);

  // 2. Compute search bounding box (wider for category searches)
  const delta = Math.max(0.05, Math.min(2, (360 / Math.pow(2, zoom)) * 2));
  const south = lat - delta;
  const north = lat + delta;
  const west = lng - delta;
  const east = lng + delta;

  // 3. Run all search sources in parallel
  // For address queries, skip name-based POI sources that would match
  // street/city name fragments (e.g. "Knights of Columbus" for "columbus pkwy")
  const allPois: OsmPoi[] = [];

  const [
    localResults,
    categoryResult,
    photonResults,
    geocodingResults,
    overtureResults,
    nameResults,
  ] = await Promise.allSettled([
    // Source 1: Local FTS5 search (instant, offline)
    // Skip for address queries — FTS matches street names against POI names
    addressQuery
      ? Promise.resolve([])
      : searchPlacesFts(parsed.brand ?? parsed.coreQuery, south, west, north, east, limit),

    // Source 2: Category search (Overpass + Nominatim bounded)
    parsed.categories
      ? searchByCategory(parsed.originalQuery, south, west, north, east, limit)
      : Promise.resolve(null),

    // Source 3: Photon geocoder (fuzzy, online)
    (() => {
      const osmTagFilter =
        parsed.categories?.length === 1
          ? CATEGORY_TO_OSM_TAG[parsed.categories[0]] ?? undefined
          : undefined;
      return searchPhoton(parsed.originalQuery, lat, lng, zoom, limit, 'en', osmTagFilter);
    })(),

    // Source 4: Address geocoding (local FTS + Nominatim)
    // For address queries, always run with the original query (preserves commas/city/state)
    addressQuery
      ? searchAddress(parsed.originalQuery, 10, lat, lng)
      : parsed.isNameSearch && !parsed.categories
        ? searchAddress(parsed.coreQuery, 10, lat, lng)
        : Promise.resolve([] as GeocodingResult[]),

    // Source 5: Online Overture fetch — populates local DB and returns fresh places
    // Skip for address queries — same name-matching pollution as Source 1
    addressQuery
      ? Promise.resolve([])
      : fetchOverturePlaces(south, west, north, east, 500),

    // Source 6: Overpass name search — finds POIs with the search term in their name
    // Skip for address queries — catches "Knights of Columbus" for "columbus pkwy"
    addressQuery
      ? Promise.resolve([])
      : fetchOsmPoisByName(south, west, north, east, parsed.coreQuery),
  ]);

  // Collect local FTS results
  if (localResults.status === 'fulfilled' && localResults.value.length > 0) {
    for (const place of localResults.value) {
      const poi = placeToOsmPoi(place);
      // Carry brand_name through for scoring
      if (place.brandName) poi.tags['polaris:brand'] = place.brandName;
      if (place.avgRating) poi.tags['polaris:avg_rating'] = String(place.avgRating);
      if (place.reviewCount) poi.tags['polaris:review_count'] = String(place.reviewCount);
      allPois.push(poi);
    }
  }

  // Collect category search results
  if (categoryResult.status === 'fulfilled' && categoryResult.value) {
    for (const poi of categoryResult.value.pois) {
      allPois.push(poi);
    }
  }

  // Collect Photon results — include all named results in scoring, not just
  // strict POI osm_keys. Places like outlet malls may have osm_key 'building'
  // but are still findable named destinations.
  // When the query matches a known category (e.g. "deli"), filter out
  // street/road results to prevent "Delile Place" from outranking actual delis.
  // For address queries, house/street results go through the address pipeline.
  const photonAddressResults: UnifiedSearchResult[] = [];
  if (photonResults.status === 'fulfilled') {
    for (const pr of photonResults.value) {
      if (!pr.poi.name) continue;

      // For address queries, promote house/street results to the address pipeline
      if (addressQuery && !pr.isPoi) {
        photonAddressResults.push({
          name: pr.displayText || pr.poi.name,
          subtitle: [pr.address.city, pr.address.state, pr.address.country]
            .filter(Boolean)
            .join(', '),
          lat: pr.poi.lat,
          lng: pr.poi.lng,
          type: 'address',
          score: 90,
          distanceKm: 0,
        });
        continue;
      }

      // Exclude roads/streets for category searches — their fuzzy name match
      // pollutes results (e.g. "Delisle Avenue" for "deli" search)
      if (parsed.categories && isStreetResult(pr)) continue;
      allPois.push(pr.poi);
    }
  }

  // Collect Overture online results — these have already been upserted into
  // the local DB by fetchOverturePlaces, but we also need them in the current
  // scoring pass since the FTS query ran *before* the upsert completed.
  if (overtureResults.status === 'fulfilled') {
    for (const place of overtureResults.value) {
      const poi = placeToOsmPoi(place);
      if (place.brandName) poi.tags['polaris:brand'] = place.brandName;
      if (place.avgRating) poi.tags['polaris:avg_rating'] = String(place.avgRating);
      if (place.reviewCount) poi.tags['polaris:review_count'] = String(place.reviewCount);
      allPois.push(poi);
    }
  }

  // Collect Overpass name-search results — catches POIs with the search term
  // in their name regardless of how they're tagged in OSM.
  if (nameResults.status === 'fulfilled') {
    for (const poi of nameResults.value) {
      allPois.push(poi);
    }
  }

  // 4. Score and rank all POI results (with viewport boost)
  const vpRect = options.viewportBounds ?? { south, north, west, east };
  let scored = scoreAndRank(allPois, parsed, lat, lng, vpRect);
  scored = deduplicateResults(scored);

  // 5. Build geocoding (address) results — from Nominatim + Photon house/street
  const addressResults: UnifiedSearchResult[] = [...photonAddressResults];
  if (geocodingResults.status === 'fulfilled') {
    for (const gr of geocodingResults.value) {
      // Skip if already covered by a Photon address result nearby
      const isDup = addressResults.some(
        (ar) => Math.abs(ar.lat - gr.entry.lat) < 0.0003 && Math.abs(ar.lng - gr.entry.lng) < 0.0003,
      );
      if (!isDup) {
        addressResults.push({
          name: gr.entry.text,
          subtitle: [gr.entry.city, gr.entry.state, gr.entry.country].filter(Boolean).join(', '),
          lat: gr.entry.lat,
          lng: gr.entry.lng,
          type: 'address',
          score: addressQuery ? 95 : 0,
          distanceKm: 0,
        });
      }
    }
  }

  // 6. Convert POI results
  const poiLimit = addressQuery ? Math.max(5, limit - addressResults.length) : limit;
  const poiResults: UnifiedSearchResult[] = scored.slice(0, poiLimit).map((sr) => ({
    name: sr.poi.name,
    subtitle: buildSubtitle(sr.poi),
    lat: sr.poi.lat,
    lng: sr.poi.lng,
    type: 'poi',
    osmType: sr.poi.type,
    osmSubtype: sr.poi.subtype,
    score: sr.score,
    distanceKm: sr.distanceKm,
    poi: sr.poi,
    brand: parsed.brand ?? undefined,
    city: sr.poi.tags['addr:city'],
  }));

  // 7. Merge: when address query, geocoding results come first; otherwise append
  let results: UnifiedSearchResult[];
  if (addressQuery && addressResults.length > 0) {
    // Deduplicate: skip address results already covered by a nearby POI
    const dedupedAddresses = addressResults.filter(
      (ar) => !poiResults.some(
        (r) => Math.abs(r.lat - ar.lat) < 0.0003 && Math.abs(r.lng - ar.lng) < 0.0003,
      ),
    );
    results = [...dedupedAddresses, ...poiResults].slice(0, limit);
  } else {
    results = [...poiResults];
    const remaining = limit - results.length;
    if (remaining > 0) {
      for (const ar of addressResults.slice(0, remaining)) {
        const isDup = results.some(
          (r) => Math.abs(r.lat - ar.lat) < 0.0003 && Math.abs(r.lng - ar.lng) < 0.0003,
        );
        if (!isDup) results.push(ar);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSubtitle(poi: OsmPoi): string {
  const parts: string[] = [];

  // Subtype label (e.g. "Restaurant", "Cafe")
  if (poi.subtype && poi.subtype !== 'place' && poi.subtype !== 'yes') {
    parts.push(formatSubtype(poi.subtype));
  }

  // Street address
  const street = poi.tags['addr:street'];
  const number = poi.tags['addr:housenumber'];
  if (number && street) {
    parts.push(`${number} ${street}`);
  } else if (street) {
    parts.push(street);
  }

  // City
  const city = poi.tags['addr:city'];
  if (city) parts.push(city);

  return parts.join(' · ');
}

function formatSubtype(subtype: string): string {
  return subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Photon osm_key values that represent streets/roads/addresses, not POIs. */
const STREET_OSM_KEYS = new Set(['highway', 'place', 'boundary', 'waterway', 'natural', 'landuse']);
const STREET_TYPES = new Set(['street', 'district', 'locality', 'city', 'county', 'state']);

/**
 * Returns true if a Photon result represents a street/road/area
 * rather than a POI. Used to filter out "Delisle Avenue"-type results
 * when the user is searching for a category like "deli".
 */
function isStreetResult(pr: { poi: OsmPoi; isPoi: boolean }): boolean {
  if (pr.isPoi) return false;
  if (STREET_OSM_KEYS.has(pr.poi.type)) return true;
  // Photon sometimes has 'type' in tags
  const photonType = pr.poi.tags['type'] ?? '';
  if (STREET_TYPES.has(photonType)) return true;
  return false;
}

// Re-export for convenience
export type { ParsedSearchQuery, ScoredResult };
