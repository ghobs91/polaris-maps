/**
 * Search-stage helpers shared by both providers.
 *
 * A provider search page yields candidate listings; only a candidate whose name
 * matches the place AND whose address/`geo` confirms it is accepted (see
 * `identity.matchIdentity`).
 */

import { namesMatch } from './core';
import { pickBestCandidate } from '../identity';
import type { ExternalRatingProvider } from './provider';
import type { ExternalRatingQuery, RatingSearchCandidate } from './types';

/** Parse candidates from search-page HTML (fetch path). */
export function candidatesFromSearchHtml(
  provider: ExternalRatingProvider,
  html: string,
  baseUrl: string,
): RatingSearchCandidate[] {
  return provider.parseSearchResults(html, baseUrl);
}

/** Parse candidates from a search-stage WebView message. */
export function candidatesFromSearchMessage(
  provider: ExternalRatingProvider,
  data: string,
): RatingSearchCandidate[] {
  return provider.parseSearchMessage(data) ?? [];
}

/**
 * Pick the candidate to load: a confirmed match (name + address/geo) first,
 * then a name-only match as a fallback. The fallback is safe because the listing
 * stage re-checks name + address/geo before anything is displayed, so a sibling
 * chain branch can never be shown.
 */
export function selectSearchCandidate(
  candidates: readonly RatingSearchCandidate[],
  query: ExternalRatingQuery,
): RatingSearchCandidate | null {
  const confirmed = pickBestCandidate(candidates, query);
  if (confirmed) return confirmed;
  return candidates.find((c) => !!c.name && namesMatch(c.name, query.name)) ?? null;
}
