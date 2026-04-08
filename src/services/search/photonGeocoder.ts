/**
 * Photon geocoder — free OSM-based search with built-in fuzzy/typo tolerance.
 * https://photon.komoot.io/
 *
 * This is used as a high-quality online fallback for POI + address search.
 * Photon returns both POIs and addresses with structured data.
 */

import type { OsmPoi } from '../poi/osmFetcher';
import { isAddressQuery } from './queryParser';

const PHOTON_BASE_URL = 'https://photon.komoot.io/api';
const PHOTON_TIMEOUT_MS = 5_000;

interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  properties: {
    osm_id: number;
    osm_type: string; // 'N' (node), 'W' (way), 'R' (relation)
    osm_key: string; // e.g. 'amenity', 'shop', 'tourism'
    osm_value: string; // e.g. 'restaurant', 'cafe'
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
    type?: string; // 'house', 'street', 'city', etc.
    extent?: [number, number, number, number]; // bbox
  };
}

interface PhotonResponse {
  type: 'FeatureCollection';
  features: PhotonFeature[];
}

/**
 * Search Photon for POIs and addresses near a location.
 *
 * @param query - User search text (Photon handles typos/fuzzy natively)
 * @param lat - Bias latitude (results ranked by proximity)
 * @param lng - Bias longitude
 * @param limit - Max results
 * @param lang - Language code (default: 'en')
 */
export async function searchPhoton(
  query: string,
  lat: number,
  lng: number,
  zoom: number = 14,
  limit: number = 20,
  lang: string = 'en',
  osmTagFilter?: string,
): Promise<PhotonResult[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    q: query,
    lat: String(lat),
    lon: String(lng),
    zoom: String(Math.round(zoom)),
    limit: String(limit),
    lang,
  });

  // Address-layer heuristic: restrict to house + street layers
  if (isAddressQuery(query)) {
    params.append('layer', 'house');
    params.append('layer', 'street');
  }

  // Category OSM tag filter
  if (osmTagFilter) {
    params.append('osm_tag', osmTagFilter);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);

  try {
    const res = await fetch(`${PHOTON_BASE_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const data: PhotonResponse = await res.json();
    return data.features
      .filter((f) => f.properties.name || f.properties.housenumber)
      .map(photonFeatureToResult);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Classes of Photon results that represent POIs (vs. addresses/admin areas). */
const POI_OSM_KEYS = new Set([
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'craft',
  'office',
  'aeroway',
  'railway',
  'highway',
]);

export interface PhotonResult {
  poi: OsmPoi;
  /** Whether this is a POI (vs. address/admin area). */
  isPoi: boolean;
  /** Structured address components. */
  address: {
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
  /** Full display text for this result. */
  displayText: string;
}

function photonFeatureToResult(feature: PhotonFeature): PhotonResult {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  const isPoi = POI_OSM_KEYS.has(p.osm_key);

  // Build display text
  const namePart =
    p.name ?? (p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street ?? ''));
  const cityPart = [p.city, p.state].filter(Boolean).join(', ');
  const displayText = cityPart ? `${namePart}, ${cityPart}` : namePart;

  const poi: OsmPoi = {
    id: p.osm_id,
    lat,
    lng,
    name: p.name ?? namePart,
    type: p.osm_key,
    subtype: p.osm_value,
    tags: {
      name: p.name ?? '',
      [p.osm_key]: p.osm_value,
      ...(p.street ? { 'addr:street': p.street } : {}),
      ...(p.housenumber ? { 'addr:housenumber': p.housenumber } : {}),
      ...(p.city ? { 'addr:city': p.city } : {}),
      ...(p.state ? { 'addr:state': p.state } : {}),
      ...(p.postcode ? { 'addr:postcode': p.postcode } : {}),
      ...(p.country ? { 'addr:country': p.country } : {}),
    },
  };

  return {
    poi,
    isPoi,
    address: {
      street: p.street,
      housenumber: p.housenumber,
      city: p.city,
      state: p.state,
      postcode: p.postcode,
      country: p.country,
    },
    displayText,
  };
}
