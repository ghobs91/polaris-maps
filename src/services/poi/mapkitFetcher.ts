import { appleMapkitToken } from '../../constants/config';

const APPLE_MAPS_BASE_URL = 'https://maps-api.apple.com/v1';

// ---------------------------------------------------------------------------
// Access token cache
// The Maps Server API issues 30-minute access tokens via POST /v1/token.
// We cache it and refresh with a 60-second buffer.
// ---------------------------------------------------------------------------
let cachedAccessToken: string | null = null;
let accessTokenExpiresAt = 0; // Unix ms

async function getAccessToken(): Promise<string | null> {
  const jwt = appleMapkitToken;
  if (!jwt) return null;

  const now = Date.now();
  if (cachedAccessToken && now < accessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const res = await fetch(`${APPLE_MAPS_BASE_URL}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) return null;

  const data = await res.json();
  cachedAccessToken = data.accessToken as string;
  accessTokenExpiresAt = now + (data.expiresInSeconds as number) * 1000;
  return cachedAccessToken;
}

/** Clear the cached access token (for tests). */
export function clearAccessTokenCache() {
  cachedAccessToken = null;
  accessTokenExpiresAt = 0;
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
