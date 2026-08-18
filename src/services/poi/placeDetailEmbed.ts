import { mapkitJsEmbedToken, mapkitPlaceDetailUrl } from '../../constants/config';
import type { OsmPoi } from './osmFetcher';

/**
 * Builds the URL for the hosted MapKit JS PlaceDetail page, which renders
 * Apple's interactive place card (photos, reviews, hours, …) inline in the
 * POI card via a WebView.
 */

export type PlaceDetailTheme = 'light' | 'dark' | 'adaptive';

/** Apple Place ID captured from the Maps Server API, if present. */
export function getApplePlaceId(poi: OsmPoi): string | null {
  const id = poi.tags?.['apple:place_id'];
  return id ? String(id) : null;
}

/**
 * Build the embed URL for a POI.
 *
 * - `placeId` is preferred: it gives a deterministic match in Apple's database.
 * - Falls back to a name + coordinate search inside the hosted page.
 * - The MapKit JS token (portal-issued, domain-restricted) is passed in the URL
 *   fragment (`#token=…`) so it is never sent to the server or written to
 *   access logs.
 *
 * Returns `null` when the embed is not configured (no hosted page URL or no
 * token).
 */
export function buildPlaceDetailUrl(
  poi: Pick<OsmPoi, 'name' | 'lat' | 'lng' | 'tags'>,
  theme: PlaceDetailTheme = 'adaptive',
  language?: string,
): string | null {
  if (!mapkitPlaceDetailUrl || !mapkitJsEmbedToken) return null;

  const params = new URLSearchParams({
    name: poi.name,
    lat: String(poi.lat),
    lng: String(poi.lng),
    theme,
  });
  if (language) params.set('lang', language);

  const placeId = getApplePlaceId(poi as OsmPoi);
  if (placeId) params.set('placeId', placeId);

  // Token via fragment: not sent to the server, not logged.
  const token = mapkitJsEmbedToken;
  const fragment = `#token=${encodeURIComponent(token)}`;

  return `${mapkitPlaceDetailUrl}?${params.toString()}${fragment}`;
}
