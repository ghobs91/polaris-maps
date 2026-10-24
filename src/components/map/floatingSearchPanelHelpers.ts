import type { GeocodingResult } from '../../services/geocoding/geocodingService';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';
import { normalizeSearchText } from '../../services/search/queryParser';
import { resolveSearchCategories } from '../../services/poi/categoryResolver';
import type { OsmPoi } from '../../services/poi/osmFetcher';

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
