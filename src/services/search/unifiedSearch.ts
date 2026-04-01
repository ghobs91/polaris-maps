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
import { parseSearchQuery, fuzzyMatchBrand, type ParsedSearchQuery } from './queryParser';
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

  // 1. Parse the query into structured intent
  const parsed = parseSearchQuery(query);

  // Also check for fuzzy brand matches (handles typos like "starbuks")
  if (!parsed.brand) {
    const fuzzyBrand = fuzzyMatchBrand(query);
    if (fuzzyBrand) parsed.brand = fuzzyBrand;
  }

  // 2. Compute search bounding box (wider for category searches)
  const delta = Math.max(0.05, Math.min(2, (360 / Math.pow(2, zoom)) * 2));
  const south = lat - delta;
  const north = lat + delta;
  const west = lng - delta;
  const east = lng + delta;

  // 3. Run all search sources in parallel
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
    searchPlacesFts(parsed.brand ?? parsed.coreQuery, south, west, north, east, limit),

    // Source 2: Category search (Overpass + Nominatim bounded)
    parsed.categories
      ? searchByCategory(parsed.originalQuery, south, west, north, east, limit)
      : Promise.resolve(null),

    // Source 3: Photon geocoder (fuzzy, online)
    searchPhoton(parsed.originalQuery, lat, lng, limit),

    // Source 4: Address geocoding (local FTS + Nominatim)
    parsed.isNameSearch && !parsed.categories
      ? searchAddress(parsed.coreQuery, 10)
      : Promise.resolve([] as GeocodingResult[]),

    // Source 5: Online Overture fetch — populates local DB and returns
    // fresh places so searches work even when the area hasn't been browsed yet.
    fetchOverturePlaces(south, west, north, east, 500),

    // Source 6: Overpass name search — finds POIs with the search term in
    // their name regardless of OSM tag, catching places like
    // "Turnpike Bagels Deli & Bakery" that may be tagged as a bakery.
    fetchOsmPoisByName(south, west, north, east, parsed.coreQuery),
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
  if (photonResults.status === 'fulfilled') {
    for (const pr of photonResults.value) {
      if (!pr.poi.name) continue;
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

  // 5. Convert to unified results
  const results: UnifiedSearchResult[] = scored.slice(0, limit).map((sr) => ({
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

  // 6. Append geocoding (address) results at the end if we have room
  if (geocodingResults.status === 'fulfilled') {
    const remaining = limit - results.length;
    if (remaining > 0) {
      for (const gr of geocodingResults.value.slice(0, remaining)) {
        // Skip if this address is already covered by a POI result nearby
        const isDup = results.some(
          (r) => Math.abs(r.lat - gr.entry.lat) < 0.0003 && Math.abs(r.lng - gr.entry.lng) < 0.0003,
        );
        if (!isDup) {
          results.push({
            name: gr.entry.text,
            subtitle: [gr.entry.city, gr.entry.state, gr.entry.country].filter(Boolean).join(', '),
            lat: gr.entry.lat,
            lng: gr.entry.lng,
            type: 'address',
            score: 0,
            distanceKm: 0,
          });
        }
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
