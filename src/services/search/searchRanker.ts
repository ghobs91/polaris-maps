/**
 * Unified relevance scoring for search results.
 *
 * Combines multiple signals into a single 0–100 score:
 * - Text match quality (FTS rank, name containment, brand match)
 * - Distance from viewport center (closer = better)
 * - Category / cuisine match strength
 * - Rating / review count (popularity proxy)
 */

import type { OsmPoi } from '../poi/osmFetcher';
import type { ParsedSearchQuery } from './queryParser';
import { levenshtein, normalizeSearchText } from './queryParser';

export interface ScoredResult {
  poi: OsmPoi;
  score: number;
  /** Distance in km from the reference point. */
  distanceKm: number;
}

/** Optional viewport bounds for in-viewport boosting. */
export interface ViewportRect {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface RankingContext {
  viewport?: ViewportRect;
  userLocation?: { lat: number; lng: number };
  proximityAnchor?: 'viewport' | 'user' | 'mixed';
  locationSensitivityKm?: number;
  queryDensity?: 'dense' | 'normal' | 'sparse';
  inViewportProximityFloor?: number;
}

/**
 * Score and rank a list of POIs against a parsed search query.
 *
 * @param pois - The raw POI results from any source
 * @param parsed - The parsed search query intent
 * @param refLat - Reference latitude (viewport center or user location)
 * @param refLng - Reference longitude
 * @param viewport - Optional viewport bounds; results inside get a score bonus
 */
export function scoreAndRank(
  pois: OsmPoi[],
  parsed: ParsedSearchQuery,
  refLat: number,
  refLng: number,
  context?: RankingContext,
): ScoredResult[] {
  const scored = pois.map((poi) => {
    const distanceKm = getEffectiveDistanceKm(poi, refLat, refLng, context);
    const score = computeScore(poi, parsed, distanceKm, context, refLat, refLng);
    return { poi, score, distanceKm };
  });

  // Sort by score descending, then by distance ascending for ties
  scored.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

  return scored;
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/** Maximum scoring weights (sum to ~100). */
const W_TEXT = 40; // Text match quality
const W_DISTANCE = 30; // Proximity
const W_CATEGORY = 15; // Category/cuisine match
const W_POPULARITY = 15; // Rating + review count
const W_VIEWPORT = 15; // Bonus for being inside current viewport

function computeScore(
  poi: OsmPoi,
  parsed: ParsedSearchQuery,
  distanceKm: number,
  context: RankingContext | undefined,
  refLat: number,
  refLng: number,
): number {
  let score = 0;
  const viewport = context?.viewport;
  const inView =
    !!viewport &&
    poi.lat >= viewport.south &&
    poi.lat <= viewport.north &&
    poi.lng >= viewport.west &&
    poi.lng <= viewport.east;

  // --- Text match (0–40) ---
  const textScore = textMatchScore(poi, parsed);
  score += textScore * W_TEXT;

  // --- Distance (0–30) ---
  const sensitivityKm = context?.locationSensitivityKm ?? 10;
  let distanceFactor = Math.exp(-distanceKm / sensitivityKm);
  if (inView && (context?.proximityAnchor ?? 'viewport') !== 'user') {
    distanceFactor = Math.max(distanceFactor, context?.inViewportProximityFloor ?? 0.9);
  }

  let effectiveDistanceWeight = W_DISTANCE;
  if (context?.queryDensity === 'dense' && (parsed.brand || parsed.isNameSearch)) {
    effectiveDistanceWeight *= 1.2;
  } else if (context?.queryDensity === 'sparse' && textScore >= 0.75) {
    effectiveDistanceWeight *= 0.55;
  } else if (textScore >= 0.85) {
    effectiveDistanceWeight *= 0.8;
  }
  score += distanceFactor * effectiveDistanceWeight;

  // --- Category/cuisine match (0–15) ---
  score += categoryMatchScore(poi, parsed) * W_CATEGORY;

  // --- Popularity (0–15) ---
  score += popularityScore(poi) * W_POPULARITY;

  // --- Viewport bonus (0–10) ---
  if (inView) score += W_VIEWPORT;

  return score;
}

export function textMatchScore(poi: OsmPoi, parsed: ParsedSearchQuery): number {
  const query = normalizeSearchText(parsed.coreQuery).toLowerCase();
  const name = normalizeSearchText(poi.name).toLowerCase();
  const brandTag = normalizeSearchText(
    poi.tags['brand'] ?? poi.tags['brand:wikidata'] ?? '',
  ).toLowerCase();

  // Exact name match
  if (name === query) return 1.0;

  // Brand match from the manual alias list (highest confidence)
  if (parsed.brand) {
    const brandLower = normalizeSearchText(parsed.brand).toLowerCase();
    if (name.includes(brandLower) || brandTag.includes(brandLower)) return 0.95;
    const poiBrand = normalizeSearchText(poi.tags['polaris:brand'] ?? '').toLowerCase();
    if (poiBrand && poiBrand.includes(brandLower)) return 0.95;
  }

  // Brand match from the Overture brand_name tag — works for ANY brand in the
  // database without needing a manual alias. Slightly lower score (0.90 vs
  // 0.95) to prefer confirmed aliases when available.
  const poiBrandTag = normalizeSearchText(poi.tags['polaris:brand'] ?? '').toLowerCase();
  if (
    poiBrandTag &&
    (poiBrandTag === query || poiBrandTag.includes(query) || query.includes(poiBrandTag))
  ) {
    return 0.9;
  }

  // Name starts with query
  if (name.startsWith(query)) return 0.85;

  // Name contains query as a whole word
  const wordBoundary = new RegExp(`\\b${escapeRegex(query)}\\b`, 'i');
  if (wordBoundary.test(name)) return 0.75;

  // Name contains query as substring
  if (name.includes(query)) return 0.6;

  // Query contains the place name (e.g. "starbucks coffee" search, poi name "Starbucks")
  if (query.includes(name) && name.length >= 3) return 0.55;

  // Fuzzy match — for short queries check edit distance
  if (query.length >= 3 && name.length >= 3) {
    // Compare against the first word of the name for single-word queries
    const nameFirst = name.split(/\s+/)[0];
    const maxDist = query.length <= 5 ? 1 : 2;
    if (levenshtein(query, nameFirst) <= maxDist) return 0.5;
    if (levenshtein(query, name) <= maxDist) return 0.45;
  }

  // Word-level matching: score based on how many query words match name words.
  // Matching 1 out of 4 query words is much weaker than matching 1 out of 1.
  const queryWords = query.split(/\s+/);
  const nameWords = name.split(/\s+/);
  let matchedQueryWords = 0;
  for (const qw of queryWords) {
    for (const nw of nameWords) {
      if (qw.length >= 3 && (nw.startsWith(qw) || qw.startsWith(nw))) {
        matchedQueryWords++;
        break;
      }
    }
  }
  if (matchedQueryWords > 0) {
    const coverage = matchedQueryWords / queryWords.length;
    return 0.35 * coverage;
  }

  return 0;
}

function categoryMatchScore(poi: OsmPoi, parsed: ParsedSearchQuery): number {
  if (!parsed.categories && !parsed.cuisineHint) return 0.5; // neutral

  // Cuisine match is the strongest category signal
  if (parsed.cuisineHint) {
    const cuisine = parsed.cuisineHint.toLowerCase();
    const poiCuisine = (poi.tags.cuisine ?? '').toLowerCase();
    const poiName = poi.name.toLowerCase();

    if (poiCuisine.includes(cuisine)) return 1.0;
    if (poiName.includes(cuisine)) return 0.8;
    if (poi.subtype?.includes(cuisine)) return 0.7;
  }

  // Category match
  if (parsed.categories) {
    const poiSubtype = poi.subtype?.toLowerCase() ?? '';
    const poiType = poi.type?.toLowerCase() ?? '';
    for (const cat of parsed.categories) {
      const catLower = cat.toLowerCase().replace(/_/g, '');
      if (poiSubtype.replace(/_/g, '') === catLower) return 0.9;
      if (poiSubtype.includes(catLower)) return 0.7;
      if (poiType.includes(catLower)) return 0.5;
    }
    // POI is in a related category but not exact match
    return 0.2;
  }

  return 0.5;
}

function popularityScore(poi: OsmPoi): number {
  // Use review_count and avg_rating if available (from Overture/community data)
  const reviewCount = parseInt(poi.tags['polaris:review_count'] ?? '0', 10);
  const avgRating = parseFloat(poi.tags['polaris:avg_rating'] ?? '0');

  // Diminishing returns on review count: log10(count + 1) / log10(1001) ≈ 0–1
  const countSignal = Math.log10(reviewCount + 1) / 3;

  // Rating normalized to 0–1 (from 1–5 scale)
  const ratingSignal = avgRating > 0 ? (avgRating - 1) / 4 : 0.3; // default to "average"

  // Brands and chains get a slight boost (they're generally popular)
  const hasBrand = poi.tags['brand'] || poi.tags['brand:wikidata'] || poi.tags['polaris:brand'];
  const brandBoost = hasBrand ? 0.1 : 0;

  return Math.min(1, countSignal * 0.4 + ratingSignal * 0.4 + brandBoost + 0.2);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/** Deduplicate results across sources using name similarity + distance. */
export function deduplicateResults(results: ScoredResult[]): ScoredResult[] {
  const kept: ScoredResult[] = [];

  for (const r of results) {
    const isDup = kept.some((existing) => {
      const dist = haversineKm(existing.poi.lat, existing.poi.lng, r.poi.lat, r.poi.lng);
      if (dist > 0.05) return false; // >50m apart — not a duplicate
      const nameA = normalizeSearchText(existing.poi.name).toLowerCase().replace(/'/g, '');
      const nameB = normalizeSearchText(r.poi.name).toLowerCase().replace(/'/g, '');
      return nameA === nameB || levenshtein(nameA, nameB) <= 2;
    });
    if (!isDup) kept.push(r);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEffectiveDistanceKm(
  poi: OsmPoi,
  refLat: number,
  refLng: number,
  context?: RankingContext,
): number {
  const viewport = context?.viewport;
  const anchor = context?.proximityAnchor ?? 'viewport';
  const viewportCenterLat = viewport ? (viewport.south + viewport.north) / 2 : refLat;
  const viewportCenterLng = viewport ? (viewport.west + viewport.east) / 2 : refLng;
  const viewportDistanceKm = haversineKm(viewportCenterLat, viewportCenterLng, poi.lat, poi.lng);
  const userDistanceKm = context?.userLocation
    ? haversineKm(context.userLocation.lat, context.userLocation.lng, poi.lat, poi.lng)
    : Infinity;

  if (anchor === 'user')
    return Number.isFinite(userDistanceKm) ? userDistanceKm : viewportDistanceKm;
  if (anchor === 'mixed') return Math.min(viewportDistanceKm, userDistanceKm);
  return viewportDistanceKm;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
