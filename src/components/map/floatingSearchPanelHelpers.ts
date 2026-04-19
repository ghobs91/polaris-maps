import type { GeocodingResult } from '../../services/geocoding/geocodingService';

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
