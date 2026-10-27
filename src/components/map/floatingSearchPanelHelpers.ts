import type { GeocodingResult } from '../../services/geocoding/geocodingService';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { normalizeSearchText } from '../../services/search/queryParser';
import { resolveSearchCategories } from '../../services/poi/categoryResolver';
import type { OsmPoi } from '../../services/poi/osmFetcher';
import {
  applyFilters,
  sortResults,
  type FilterableSearchResult,
  type SearchFilters,
  type SortOption,
} from '../../services/search/searchFilters';

export interface DirectionsTarget {
  lat: number;
  lng: number;
  name: string;
}

/**
 * Max distance (km) from the search anchor at which a nearby-intent submit may
 * still move the camera. Kept around the category search radius (~28 km) so a
 * genuinely rural search still frames its results, while a cluster in the next
 * city/borough (Westbury → Manhattan is ~40 km) never yanks the map away.
 */
export const MAX_FIT_ANCHOR_KM = 30;

export function destinationToGeocodingResult(dest: DirectionsTarget): GeocodingResult {
  return {
    entry: {
      id: 0,
      text: dest.name,
      type: 'place',
      housenumber: null,
      street: null,
      city: null,
      state: null,
      postcode: null,
      country: null,
      lat: dest.lat,
      lng: dest.lng,
    },
    rank: 0,
  };
}

export function isSameDestination(result: GeocodingResult | null, dest: DirectionsTarget): boolean {
  return !!result && result.entry.lat === dest.lat && result.entry.lng === dest.lng;
}

/**
 * Adapt a geocoding result to the shared `SearchResultRow` model. Distance is
 * left at 0 (unknown for these results) so the row omits it, and the transit
 * station variant is preserved via the `railway`/`station` tags.
 */
export function geocodingResultToSearchResult(result: GeocodingResult): UnifiedSearchResult {
  const { entry, poi, rank } = result;
  const isStation = entry.type === 'station';
  const street = [entry.housenumber, entry.street].filter(Boolean).join(' ');
  const subtitle = isStation
    ? 'Transit Station'
    : [street, entry.city, entry.state, entry.country].filter(Boolean).join(', ');

  return {
    name: entry.text,
    subtitle: subtitle || entry.text,
    lat: entry.lat,
    lng: entry.lng,
    type: poi ? 'poi' : entry.type === 'address' ? 'address' : 'place',
    osmType: poi?.type ?? (isStation ? 'railway' : undefined),
    osmSubtype: poi?.subtype ?? (isStation ? 'station' : undefined),
    score: rank,
    distanceKm: 0,
    poi,
  };
}

/** Cheap planar distance in km (pin ordering / fit heuristic only). */
export function kmBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const latKm = Math.abs(a.lat - b.lat) * 111;
  const lngKm = Math.abs(a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return Math.hypot(latKm, lngKm);
}

/**
 * Results within this radius of the search anchor count as local to the user.
 * Slightly wider than the camera-fit radius ({@link MAX_FIT_ANCHOR_KM}) so a
 * suburban search still counts its own metro as local.
 */
export const NEARBY_RESULT_KM = 50;

/**
 * Results farther than this are dropped from the merged list. Sources that
 * rank by text alone (Photon, Nominatim) can otherwise answer a New York
 * search with a 300 km Boston cluster, burying the local branches — or, when
 * nothing local matched, presenting that cluster as the answer.
 */
export const DISTANT_RESULT_KM = 120;

/**
 * Order a merged result list around the search anchor.
 *
 * The list mixes sources with different notions of distance: the unified
 * pipeline ranks by relevance (text match can outweigh a 300 km distance) and
 * MapKit's nearby results arrive as a plain fill. Partitioning on proximity
 * keeps every local match above the distant tail and drops that tail
 * entirely. Address results and named cities are explicit destinations and are
 * never dropped, even in another city.
 */
/**
 * Results the user named explicitly — an address, a city, a landmark — as
 * opposed to a generic match from a POI source.
 */
function isExplicitDestination(result: GeocodingResult): boolean {
  return (
    result.entry.type === 'address' ||
    result.poi?.subtype === 'city' ||
    result.poi?.type === 'place'
  );
}

export function preferNearbyResults(
  results: GeocodingResult[],
  anchor: { lat: number; lng: number } | null | undefined,
): GeocodingResult[] {
  if (!anchor || results.length < 2) return results;

  const withDistance = results.map((result, index) => {
    const distanceKm = kmBetween(anchor, result.entry);
    return {
      result,
      index,
      distanceKm,
      // An address or a city the user named is an explicit destination: it
      // always counts as local, so searching "Paris" from New York is not
      // answered only by the café of the same name down the street.
      isLocal: isExplicitDestination(result) || distanceKm <= NEARBY_RESULT_KM,
    };
  });

  // Drop the distant tail even when nothing local matched. Keeping it is how
  // a Manhattan search for a Boston-only name ended up listing cafés 300 km
  // away as if they were answers; an empty local list is the honest answer.
  const kept = withDistance.filter(
    (entry) => isExplicitDestination(entry.result) || entry.distanceKm <= DISTANT_RESULT_KM,
  );

  return kept
    .sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.index - b.index)
    .map((entry) => entry.result);
}

/**
 * Pick the pins shown for a result set, and the subset worth framing.
 *
 * With an anchor (the user's location at submit time), places are ordered
 * nearest-first, so a dense far-away cluster matched by the same generic query
 * can't take over the pins the user is scanning.
 */
export function selectSearchPins(
  mapPois: OsmPoi[],
  anchor?: { lat: number; lng: number } | null,
): OsmPoi[] {
  const candidates = anchor
    ? [...mapPois].sort((a, b) => kmBetween(anchor, a) - kmBetween(anchor, b))
    : mapPois;

  if (candidates.length <= 5) return candidates;

  const pins = candidates.slice(0, 5);
  const first = pins[0];
  let maxDistanceKm = 0;

  for (const poi of pins.slice(1)) {
    maxDistanceKm = Math.max(maxDistanceKm, kmBetween(first, poi));
  }

  // If one of the first results is still much farther out than the local cluster,
  // keep the map centered on the tighter group the user is likely scanning.
  if (maxDistanceKm > 18) {
    return pins.filter((poi) => kmBetween(first, poi) <= 12);
  }

  return pins;
}

export function boundsForPois(mapPois: OsmPoi[]): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} | null {
  if (mapPois.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of mapPois) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const latPad = (maxLat - minLat) * 0.1 || 0.005;
  const lngPad = (maxLng - minLng) * 0.1 || 0.005;

  return {
    minLat: minLat - latPad,
    minLng: minLng - lngPad,
    maxLat: maxLat + latPad,
    maxLng: maxLng + lngPad,
  };
}

/**
 * Apply the user's filter/sort view to the merged result rows.
 *
 * The floating panel builds its list from its own merge (stations, MapKit
 * nearby rows and ranked hits), which bypasses `usePlaceSearch`'s filtered
 * view. Without this the filter sheet and sort option were cosmetic there:
 * only the category filter reached the search, through source gating.
 *
 * Rows without a ranked payload (transit stations, MapKit fills) are scored as
 * "unknown" for rating/price and get a real distance so distance sorting and
 * the max-distance filter still work for them.
 */
export function applySearchView(
  rows: GeocodingResult[],
  rankedById: Map<string, UnifiedSearchResult>,
  anchor: { lat: number; lng: number } | null,
  filters: SearchFilters,
  sort: SortOption,
): GeocodingResult[] {
  if (rows.length === 0) return rows;

  const byFilterable = new Map<FilterableSearchResult, GeocodingResult>();
  const filterables = rows.map((row) => {
    const ranked = rankedById.get(String(row.entry.id));
    const base: FilterableSearchResult = ranked ?? geocodingResultToSearchResult(row);
    const distanceKm = base.distanceKm || (anchor ? kmBetween(anchor, row.entry) : 0);
    const filterable = { ...base, distanceKm };
    byFilterable.set(filterable, row);
    return filterable;
  });

  return sortResults(applyFilters(filterables, filters), sort).map(
    (filterable) => byFilterable.get(filterable)!,
  );
}

/**
 * Whether a submitted search may move the camera to frame these pins.
 *
 * Place/brand/address lookups may frame a distant match (that is the intent).
 * Nearby-intent queries stay put when every match is a long way off, so
 * "bagels" searched from Westbury can never fly the map to Manhattan.
 */
export function shouldFrameResults(
  pins: OsmPoi[],
  anchor: { lat: number; lng: number } | null | undefined,
  allowDistantMatch: boolean,
): boolean {
  if (pins.length === 0) return false;
  if (allowDistantMatch || !anchor) return true;
  return kmBetween(anchor, pins[0]) <= MAX_FIT_ANCHOR_KM;
}

/** Filler words that don't turn a category phrase into a place lookup. */
const QUERY_MODIFIERS = new Set([
  'near',
  'nearby',
  'me',
  'my',
  'here',
  'around',
  'open',
  'now',
  'late',
  'best',
  'top',
  'rated',
  'good',
  'popular',
  'cheap',
  'closest',
  'nearest',
  'the',
  'a',
  'an',
  'in',
  'at',
  'on',
  'to',
  'for',
  'find',
  'search',
  'show',
]);

/**
 * True when the query is only a category phrase ("bagels", "coffee near me"),
 * i.e. the answer is expected around the user. A proper-name token ("h&h
 * bagels", "pizza palace") makes it a place lookup, which may frame a distant
 * match — Google pans to "H&H Bagels", but not to "bagels".
 */
export function isGenericNearbyQuery(query: string): boolean {
  const words = normalizeSearchText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !QUERY_MODIFIERS.has(word));
  if (words.length === 0) return false;
  return words.every((word) => resolveSearchCategories(word) !== null);
}
