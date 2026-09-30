/**
 * Resolve the place at a tapped address (a basemap house-number label).
 *
 * Tapping a house number should surface the place that occupies that address
 * when we already know it — i.e. an entry in the local `places` index (Overture
 * / community). When nothing is known within the perimeter we fall back to a
 * reverse-geocoded address card (same shape as a long-press selection) so the
 * tap is never a dead end.
 */

import { getNearbyPlaces } from './poiService';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';
import { resolveMapSelectionPoi } from './mapSelectionPoi';
import type { OsmPoi } from './osmFetcher';

/** Places within this radius of the tapped number are candidates. ~60 m. */
export const ADDRESS_TAP_RADIUS_KM = 0.06;

/**
 * Return the nearest known place to (lat, lng), or a reverse-geocoded address
 * card when the local index has nothing in range.
 */
export async function resolvePlaceAtAddress(lat: number, lng: number): Promise<OsmPoi> {
  const nearby = await getNearbyPlaces(lat, lng, ADDRESS_TAP_RADIUS_KM).catch(() => []);
  const nearest = nearby[0];
  if (nearest) return placeToOsmPoi(nearest);
  return resolveMapSelectionPoi(lat, lng);
}
