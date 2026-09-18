import { findPlaceIdNear, getNearbyPlaces, getPlaceById, searchPlacesFts } from '../poi/poiService';
import type { Place } from '../../models/poi';
import type { PlaceReviewContext } from '../../models/review';
import { haversineMeters } from '../../utils/routeSnap';

/**
 * Match a Google review to a place already in the local Polaris database.
 *
 * Offline-first and local-only: no network lookups. Strategy, in order:
 *  1. Exact/partial name match within 150 m of the review coordinates.
 *  2. Name-containment match within 1 km.
 *  3. Nearest place within 150 m (same storefront, slightly renamed).
 *  4. FTS name search in a small bbox around the coordinates.
 *
 * Returns null when nothing matches — the caller skips the review and
 * reports it as unmatched (never fabricates a place).
 */

export interface ResolvedReviewPlace {
  place: Place;
  context: PlaceReviewContext;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export async function resolvePlaceForReview(
  lat: number,
  lng: number,
  name: string,
): Promise<ResolvedReviewPlace | null> {
  // 1–3. Local proximity + name matching via the shared POI helpers.
  for (const radiusMeters of [150, 1000]) {
    const uuid = await findPlaceIdNear(lat, lng, name, radiusMeters);
    if (!uuid) continue;
    const place = await getPlaceById(uuid);
    if (!place) continue;
    // findPlaceIdNear already prefers name matches; for the wide radius,
    // require the name to actually match so a far-away neighbour isn't
    // picked up just for being nearby.
    if (radiusMeters > 150 && !namesMatch(place.name, name)) continue;
    return { place, context: toContext(place) };
  }

  // 4. FTS name search in a small bbox, closest match wins.
  const delta = 0.02; // ~2 km
  try {
    const candidates = await searchPlacesFts(
      name,
      lat - delta,
      lng - delta,
      lat + delta,
      lng + delta,
      10,
    );
    let best: Place | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (!namesMatch(candidate.name, name)) continue;
      const distance = haversineMeters([lng, lat], [candidate.lng, candidate.lat]);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best && bestDistance <= 2000) {
      return { place: best, context: toContext(best) };
    }
  } catch {
    // FTS table may be unavailable — fall through to the nearby scan.
  }

  // 5. Last resort: exact-name match among places within 1 km.
  try {
    const nearby = await getNearbyPlaces(lat, lng, 1);
    const exact = nearby.find((p) => normalizeName(p.name) === normalizeName(name));
    if (exact) return { place: exact, context: toContext(exact) };
  } catch {
    // Local DB unavailable — treat as unmatched.
  }

  return null;
}

function toContext(place: Place): PlaceReviewContext {
  return {
    poiUuid: place.uuid,
    // Community places are Polaris-native; the review context has no
    // 'community' variant, so they map to 'polaris'.
    source: place.source === 'overture' ? 'overture' : 'polaris',
    name: place.name,
    lat: place.lat,
    lng: place.lng,
  };
}
