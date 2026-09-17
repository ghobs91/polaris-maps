import type { GeocodingResult } from '../../services/geocoding/geocodingService';
import type { UnifiedSearchResult } from '../../services/search/unifiedSearch';

export interface DirectionsTarget {
  lat: number;
  lng: number;
  name: string;
}

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
