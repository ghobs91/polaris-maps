/**
 * Listing identity matching for external rating candidates.
 *
 * A candidate is accepted only when its name matches the place name AND an
 * address or `geo` proximity signal confirms it. This prevents showing a
 * sibling chain branch's rating. Search results in particular cannot be trusted
 * on name alone.
 */

import { namesMatch } from './externalRatings/core';
import { addressesMatch, withinMeters } from './poiAddress';
import type { ExternalRatingQuery, GeoPoint, RatingSearchCandidate } from './externalRatings/types';

/** Maximum distance (meters) for a `geo` confirmation to count as the same place. */
export const GEO_MATCH_METERS = 50;

export interface IdentityCandidate {
  name: string | null;
  address?: string | null;
  geo?: GeoPoint | null;
}

/**
 * True when a candidate is confidently the same place as the query: the name
 * matches and either the coordinates are within {@link GEO_MATCH_METERS} or the
 * addresses match.
 */
export function matchIdentity(candidate: IdentityCandidate, query: ExternalRatingQuery): boolean {
  if (!candidate.name || !namesMatch(candidate.name, query.name)) return false;

  if (
    candidate.geo &&
    withinMeters(candidate.geo, { lat: query.lat, lng: query.lng }, GEO_MATCH_METERS)
  ) {
    return true;
  }

  if (candidate.address && query.address && addressesMatch(candidate.address, query.address)) {
    return true;
  }

  return false;
}

/** First candidate that confidently matches the query, or null. */
export function pickBestCandidate(
  candidates: readonly RatingSearchCandidate[],
  query: ExternalRatingQuery,
): RatingSearchCandidate | null {
  return candidates.find((candidate) => matchIdentity(candidate, query)) ?? null;
}
