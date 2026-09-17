/**
 * Build and parse shareable place links.
 *
 * Canonical places use a universal link (`https://polarismaps.com/p/<id>`);
 * places without a canonical id fall back to coordinates (+ optional name)
 * encoded in the link so the app can still resolve them.
 */

export const PLACE_LINK_HOST = 'polarismaps.com';
export const PLACE_LINK_PATH_PREFIX = '/p';
export const PLACE_SCHEME = 'polaris-maps';

export interface PlaceLinkTarget {
  canonicalId?: string | null;
  lat: number;
  lng: number;
  name?: string;
}

export interface ParsedPlaceLink {
  canonicalId?: string;
  lat?: number;
  lng?: number;
  name?: string;
}

/** Build a shareable link for a place. */
export function buildPlaceLink(target: PlaceLinkTarget): string {
  if (target.canonicalId) {
    return `https://${PLACE_LINK_HOST}${PLACE_LINK_PATH_PREFIX}/${encodeURIComponent(target.canonicalId)}`;
  }
  const params = new URLSearchParams({
    lat: String(target.lat),
    lng: String(target.lng),
  });
  if (target.name) params.set('name', target.name);
  return `https://${PLACE_LINK_HOST}${PLACE_LINK_PATH_PREFIX}?${params.toString()}`;
}

/** Build the app-scheme fallback link (used when universal links are absent). */
export function buildPlaceSchemeLink(target: PlaceLinkTarget): string {
  const params = new URLSearchParams({ lat: String(target.lat), lng: String(target.lng) });
  if (target.name) params.set('name', target.name);
  const idPart = target.canonicalId ? `/${encodeURIComponent(target.canonicalId)}` : '';
  return `${PLACE_SCHEME}://place${idPart}?${params.toString()}`;
}

function parseCoords(url: URL): { lat?: number; lng?: number } {
  const latRaw = url.searchParams.get('lat');
  const lngRaw = url.searchParams.get('lng');
  const lat = latRaw == null ? undefined : Number(latRaw);
  const lng = lngRaw == null ? undefined : Number(lngRaw);
  return {
    lat: lat != null && Number.isFinite(lat) ? lat : undefined,
    lng: lng != null && Number.isFinite(lng) ? lng : undefined,
  };
}

/** Parse a place link (universal or scheme). Returns null for unrelated URLs. */
export function parsePlaceLink(raw: string): ParsedPlaceLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const isUniversal =
    url.hostname === PLACE_LINK_HOST && url.pathname.startsWith(PLACE_LINK_PATH_PREFIX);
  const isScheme = url.protocol === `${PLACE_SCHEME}:`;
  if (!isUniversal && !isScheme) return null;

  const name = url.searchParams.get('name') ?? undefined;
  const coords = parseCoords(url);

  if (isScheme) {
    // polaris-maps://place/<id>?lat=..&lng=..
    const segments = url.pathname.split('/').filter(Boolean);
    const canonicalId = segments[0] ? decodeURIComponent(segments[0]) : undefined;
    return { canonicalId, name, ...coords };
  }

  // https://polarismaps.com/p/<id>
  const afterPrefix = url.pathname.slice(PLACE_LINK_PATH_PREFIX.length).replace(/^\/+/, '');
  const canonicalId = afterPrefix ? decodeURIComponent(afterPrefix) : undefined;
  return { canonicalId, name, ...coords };
}
