/**
 * TripAdvisor external rating — compatibility surface.
 *
 * The implementation now lives under `externalRatings/` (shared `core` +
 * `tripadvisorProvider`). This module preserves the original public API so
 * existing callers and tests keep working unchanged.
 */

import {
  clearExternalRatingCache,
  fetchPageHtml,
  validateExternalRating as validateExternalRatingCore,
} from './externalRatings/core';
import {
  discoverTripadvisorFromWebsiteHtml,
  isTripadvisorUrl,
  parseTripadvisorListingUrl,
} from './externalRatings/tripadvisorProvider';
import { normalizeWebsiteUrl } from './websitePhotosService';
import type {
  ExternalRatingProviderId,
  ExternalRatingSummary,
  RawExternalRating,
} from './externalRatings/types';

// Re-export provider-agnostic helpers and TripAdvisor specifics unchanged.
export {
  hasChallengeMarkers,
  pageIsChallenge,
  namesMatch,
  parseExactCount,
  parseRatingFromStarText,
} from './externalRatings/core';
export {
  TRIPADVISOR_ALLOWED_HOSTS,
  TRIPADVISOR_RATING_JS,
  TRIPADVISOR_SEARCH_JS,
  discoverTripadvisorFromWebsiteHtml,
  extractRatingFromWebViewMessage,
  extractSearchFromWebViewMessage,
  isAllowedTripadvisorHost,
  isTripadvisorUrl,
  parseExternalRatingFromHtml,
  parseTripadvisorListingUrl,
  parseTripadvisorSearchResults,
  resolveTripadvisorUrl,
} from './externalRatings/tripadvisorProvider';
export { isHttpUrl } from './websitePhotosService';

export type { ExternalRatingProviderId, ExternalRatingSummary, RawExternalRating };
/** @deprecated Use `ExternalRatingProviderId`; retained for compatibility. */
export type ExternalRatingProvider = 'tripadvisor';

/**
 * Validate a raw TripAdvisor extraction. Thin wrapper over the shared core so the
 * original `(raw, listingUrl, options?)` signature is preserved.
 */
export function validateExternalRating(
  raw: RawExternalRating,
  listingUrl: string,
  options?: { expectedName?: string | null },
): ExternalRatingSummary | null {
  return validateExternalRatingCore(raw, listingUrl, 'tripadvisor', options);
}

export function clearTripadvisorRatingCache(): void {
  clearExternalRatingCache();
}

export interface FetchRatingOptions {
  /** Explicit listing URL override (e.g. user-pasted). */
  overrideUrl?: string | null;
  /** Timeout for the fetch + extraction (ms). */
  timeoutMs?: number;
}

/**
 * Resolve a TripAdvisor listing URL for a POI: explicit tag/override first, then
 * a listing linked from the POI website. Search-based discovery is handled by
 * the UI controller (it requires the hidden WebView).
 */
export async function resolveRatingSource(
  poi: { name: string; tags?: Record<string, string>; website?: string | null },
  options?: FetchRatingOptions,
): Promise<{ listingUrl: string; listingName: string | null } | null> {
  const explicit = options?.overrideUrl ?? poi.tags?.['polaris:tripadvisor'];
  if (explicit && isTripadvisorUrl(explicit)) {
    const info = parseTripadvisorListingUrl(explicit);
    return info ? { listingUrl: info.url, listingName: null } : null;
  }

  const website = normalizeWebsiteUrl(poi.website ?? null);
  if (website) {
    const html = await fetchPageHtml(website, options?.timeoutMs ?? 8000);
    if (html) {
      const discovered = discoverTripadvisorFromWebsiteHtml(html, website);
      if (discovered) return { listingUrl: discovered, listingName: null };
    }
  }

  return null;
}
