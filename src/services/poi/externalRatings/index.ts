/**
 * External rating provider registry and resolution helpers.
 *
 * Resolution order per provider (highest trust first):
 *  1. explicit `polaris:<provider>` tag (or caller override),
 *  2. a provider listing linked from the place website,
 *  3. a provider search — reserved for the UI controller, because it needs the
 *     hidden WebView.
 *
 * Ratings are transient and device-local; only the aggregate number, its exact
 * count, the listing identity, and the source URL are ever returned.
 */

import {
  getCachedExternalRating,
  fetchDiscoveryHtml,
  fetchPageHtml,
  setCachedExternalRating,
  validateExternalRating,
} from './core';
import { tripadvisorProvider } from './tripadvisorProvider';
import { yelpProvider } from './yelpProvider';
import { normalizeWebsiteUrl } from '../websitePhotosService';
import type { ExternalRatingProvider } from './provider';
import type { ExternalRatingProviderId, ExternalRatingQuery, ExternalRatingSummary } from './types';

export const EXTERNAL_RATING_PROVIDERS: readonly ExternalRatingProvider[] = [
  tripadvisorProvider,
  yelpProvider,
];

export function providerById(id: ExternalRatingProviderId): ExternalRatingProvider {
  const provider = EXTERNAL_RATING_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown external rating provider: ${id}`);
  return provider;
}

/**
 * Resolve a known listing URL for a provider: explicit tag/override first, then
 * a listing linked from the place website. Does not search (see `search.ts`).
 */
export async function resolveKnownListing(
  provider: ExternalRatingProvider,
  query: ExternalRatingQuery,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  const tag = query.tags?.[`polaris:${provider.id}`];
  if (tag && provider.isProviderUrl(tag)) {
    const canonical = provider.parseListingUrl(tag);
    if (canonical) return canonical;
  }

  const website = normalizeWebsiteUrl(query.website ?? null);
  if (website) {
    // Cached + single-flight: both providers share one homepage fetch.
    const html = await fetchDiscoveryHtml(website, options?.timeoutMs);
    if (html) {
      const discovered = provider.discoverFromWebsiteHtml(html, website);
      if (discovered) return discovered;
    }
  }

  return null;
}

/**
 * True for a URL the hidden WebView may load: an http(s) URL on one of the
 * registered providers' allowed hosts. Off-allowlist hosts and non-web schemes
 * (`data:`, `blob:`, `file:`, …) are rejected by the WebView navigation gate
 * (see the `headless-browse-policy` spec).
 */
export function isAllowedExternalRatingUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return EXTERNAL_RATING_PROVIDERS.some((provider) =>
    (provider.allowedHosts as readonly string[]).includes(host),
  );
}

/**
 * Fetch a listing, parse its aggregate rating, validate it against the place,
 * and cache the result. Returns null on any failure (challenge, no data, or a
 * listing-name mismatch).
 */
export async function fetchAndParseRating(
  provider: ExternalRatingProvider,
  listingUrl: string,
  query: ExternalRatingQuery,
  options?: { timeoutMs?: number },
): Promise<ExternalRatingSummary | null> {
  const cached = getCachedExternalRating(provider.id, listingUrl);
  if (cached) return cached;

  const html = await fetchPageHtml(listingUrl, options?.timeoutMs ?? 8000);
  if (!html) return null;

  const raw = provider.parseRatingFromHtml(html);
  if (!raw) return null;

  const summary = validateExternalRating(raw, listingUrl, provider.id, {
    expectedName: query.name,
  });
  if (!summary) return null;

  setCachedExternalRating(provider.id, listingUrl, summary);
  return summary;
}

/**
 * Fetch-only resolution across both providers (no WebView): explicit tag or
 * website link, then a plain fetch + parse. Providers that need JS rendering
 * are handled by the UI controller, which falls back to the hidden WebView.
 */
export async function resolveExternalRatings(
  query: ExternalRatingQuery,
): Promise<ExternalRatingSummary[]> {
  const results = await Promise.all(
    EXTERNAL_RATING_PROVIDERS.map(async (provider) => {
      const listingUrl = await resolveKnownListing(provider, query);
      if (!listingUrl) return null;
      return fetchAndParseRating(provider, listingUrl, query);
    }),
  );
  return results.filter((s): s is ExternalRatingSummary => s !== null);
}

export { clearExternalRatingCache } from './core';
export { combineExternalRatings, type CombinedRating } from './combine';
export {
  candidatesFromSearchHtml,
  candidatesFromSearchMessage,
  selectSearchCandidate,
} from './search';
