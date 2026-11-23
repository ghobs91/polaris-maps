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

/**
 * City token from an assembled address.
 *
 * The city is the last segment after the state and postcode are stripped —
 * `"75 9th Ave, New York NY 10011"` and `"75 9th Ave, New York, NY 10011"` both
 * yield `new york`, while a segment that is only a street line (it starts with a
 * house number, or strips to nothing) is skipped.
 */
export function cityTokensFromAddress(address: string | null | undefined): string[] {
  if (!address) return [];
  const segments = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const segment of [...segments].reverse()) {
    const cleaned = segment
      .replace(/\b[A-Z]{2}\b/g, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || /^\d/.test(cleaned)) continue;
    return [cleaned.toLowerCase()];
  }
  return [];
}

/**
 * Name + city confirmation, for a provider page that publishes the business
 * name and city but no address or coordinates.
 *
 * Yelp's mobile listing page is exactly that: it carries the rating, the name
 * and the city in its title ("BUDDAKAN - New York, NY - 4.1k Reviews"), and
 * nothing machine-readable about location. Requiring the query's city to appear
 * in that title is a weaker signal than coordinates, but it still rejects the
 * failure this app was fixed for — a same-named business in another city
 * (New York place vs a Willemstad, Curaçao restaurant).
 */
export function titleConfirmsCity(
  pageTitle: string | null | undefined,
  query: ExternalRatingQuery,
  listingName: string | null | undefined,
): boolean {
  if (!pageTitle || !listingName) return false;
  if (!namesMatch(listingName, query.name)) return false;
  const cities = cityTokensFromAddress(query.address ?? null);
  if (cities.length === 0) return false;
  const title = pageTitle.toLowerCase();
  return cities.some((city) => title.includes(city));
}

/** First candidate that confidently matches the query, or null. */
export function pickBestCandidate(
  candidates: readonly RatingSearchCandidate[],
  query: ExternalRatingQuery,
): RatingSearchCandidate | null {
  return candidates.find((candidate) => matchIdentity(candidate, query)) ?? null;
}
