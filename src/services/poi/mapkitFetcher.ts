import { appleMapkitToken } from '../../constants/config';
import type { OsmPoi } from './osmFetcher';

const APPLE_MAPS_BASE_URL = 'https://maps-api.apple.com/v1';

// ---------------------------------------------------------------------------
// Access token cache
// The Maps Server API issues 30-minute access tokens via POST /v1/token.
// We cache it and refresh with a 60-second buffer.
// ---------------------------------------------------------------------------
let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0; // Unix ms
let accessTokenPromise: Promise<string | null> | null = null;

async function getAccessToken(): Promise<string | null> {
  const jwt = appleMapkitToken;
  if (!jwt) return null;

  const now = Date.now();
  if (cachedAccessToken && now < accessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  if (accessTokenPromise) {
    return accessTokenPromise;
  }

  accessTokenPromise = (async () => {
    const res = await fetch(`${APPLE_MAPS_BASE_URL}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    });

    if (!res.ok) return null;

    const data = await res.json();
    cachedAccessToken = data.accessToken as string;
    accessTokenExpiresAt = Date.now() + (data.expiresInSeconds as number) * 1000;
    return cachedAccessToken;
  })();

  try {
    return await accessTokenPromise;
  } finally {
    accessTokenPromise = null;
  }
}

/** Clear the cached access token (for tests). */
export function clearAccessTokenCache() {
  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
  accessTokenPromise = null;
}

/**
 * A place result from the Apple Maps Server API.
 *
 * Note: The Server API does NOT return phone or website.
 * Those fields are only available via the native iOS MapKit SDK (MKMapItem).
 */
export interface AppleMapsPoi {
  id: string;
  name: string;
  /** Array of address lines, e.g. ["123 Main St", "Cupertino, CA 95014", "United States"] */
  formattedAddressLines?: string[];
  structuredAddress?: {
    thoroughfare?: string;
    subThoroughfare?: string;
    fullThoroughfare?: string;
    locality?: string;
    administrativeArea?: string;
    administrativeAreaCode?: string;
    postCode?: string;
    country?: string;
    countryCode?: string;
  };
  coordinate: { latitude: number; longitude: number };
  /** Apple Maps POI category, e.g. "Cafe", "Restaurant", "Hotel" */
  poiCategory?: string;
  country?: string;
  countryCode?: string;
}

function hashAppleId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  }
  return -(Math.abs(hash) + 1);
}

function mapAppleCategoryToOsm(category?: string): { type: string; subtype: string } {
  const key = category?.trim().toLowerCase() ?? '';
  const map: Record<string, { type: string; subtype: string }> = {
    cafe: { type: 'amenity', subtype: 'cafe' },
    restaurant: { type: 'amenity', subtype: 'restaurant' },
    bakery: { type: 'shop', subtype: 'bakery' },
    grocery: { type: 'shop', subtype: 'supermarket' },
    store: { type: 'shop', subtype: 'shop' },
    bank: { type: 'amenity', subtype: 'bank' },
    atm: { type: 'amenity', subtype: 'atm' },
    pharmacy: { type: 'amenity', subtype: 'pharmacy' },
    hospital: { type: 'amenity', subtype: 'hospital' },
    hotel: { type: 'tourism', subtype: 'hotel' },
    'fitness center': { type: 'leisure', subtype: 'fitness_centre' },
    parking: { type: 'amenity', subtype: 'parking' },
    'gas station': { type: 'amenity', subtype: 'fuel' },
  };
  return map[key] ?? { type: 'amenity', subtype: 'place' };
}

function isWithinBounds(
  poi: AppleMapsPoi,
  south: number,
  west: number,
  north: number,
  east: number,
) {
  return (
    poi.coordinate.latitude >= south &&
    poi.coordinate.latitude <= north &&
    poi.coordinate.longitude >= west &&
    poi.coordinate.longitude <= east
  );
}

function applePoiToOsmPoi(poi: AppleMapsPoi): OsmPoi {
  const mapping = mapAppleCategoryToOsm(poi.poiCategory);
  return {
    id: hashAppleId(`apple:${poi.id}`),
    lat: poi.coordinate.latitude,
    lng: poi.coordinate.longitude,
    name: poi.name,
    type: mapping.type,
    subtype: mapping.subtype,
    tags: {
      name: poi.name,
      [mapping.type]: mapping.subtype,
      'apple:place_id': poi.id,
      ...(poi.poiCategory ? { 'apple:category': poi.poiCategory } : {}),
    },
  };
}

/**
 * Search Apple Maps for places near a coordinate.
 */
export async function searchAppleMaps(
  query: string,
  lat: number,
  lng: number,
): Promise<AppleMapsPoi[]> {
  const token = await getAccessToken();
  if (!token) return [];

  const params = new URLSearchParams({
    q: query,
    searchLocation: `${lat},${lng}`,
    resultTypeFilter: 'Poi',
    lang: 'en-US',
  });

  const res = await fetch(`${APPLE_MAPS_BASE_URL}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];

  const data = await res.json();
  return (data.results ?? []) as AppleMapsPoi[];
}

/**
 * Search Apple Maps with a small query set and convert in-bounds results to OsmPoi.
 * This supplements OSM in areas like strip malls where storefront tenants are
 * often missing from Overpass.
 */
export async function fetchAppleMapsPois(
  south: number,
  west: number,
  north: number,
  east: number,
): Promise<OsmPoi[]> {
  if (!appleMapkitToken) return [];

  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  const queries = ['restaurant', 'cafe', 'grocery', 'store', 'pharmacy', 'bank'];

  const results = await Promise.all(
    queries.map((query) => searchAppleMaps(query, centerLat, centerLng).catch(() => [])),
  );

  const deduped = new Map<string, AppleMapsPoi>();
  for (const group of results) {
    for (const poi of group) {
      if (!poi.name || !isWithinBounds(poi, south, west, north, east)) continue;
      const key = `${poi.name.toLowerCase()}|${poi.coordinate.latitude.toFixed(5)}|${poi.coordinate.longitude.toFixed(5)}`;
      if (!deduped.has(key)) deduped.set(key, poi);
    }
  }

  return [...deduped.values()].map(applePoiToOsmPoi);
}

/**
 * Haversine distance in metres between two lat/lng pairs.
 */
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the best Apple Maps match for an OSM POI by name proximity.
 *
 * Returns `null` when no result is within 200 m of the target coordinates.
 */
export async function findAppleMatch(
  name: string,
  lat: number,
  lng: number,
): Promise<AppleMapsPoi | null> {
  const results = await searchAppleMaps(name, lat, lng);
  if (results.length === 0) return null;

  // Pick the closest result within 200 m
  let best: AppleMapsPoi | null = null;
  let bestDist = Infinity;
  for (const r of results) {
    const d = haversineMetres(lat, lng, r.coordinate.latitude, r.coordinate.longitude);
    if (d < 200 && d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}
