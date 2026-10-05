import type { ExternalRatingProviderId, RawExternalRating, RatingSearchCandidate } from './types';

/**
 * Everything provider-specific about locating and reading an aggregate rating.
 *
 * Shared behavior (challenge detection, JSON-LD parsing, identity validation,
 * caching, pacing) lives in `core` / `antiBot`; a provider supplies only its
 * host allowlist, URL/HTML parsing, and the two injected WebView scripts.
 */
export interface ExternalRatingProvider {
  id: ExternalRatingProviderId;

  /** Exact host allowlist. Only these hosts are ever loaded. */
  allowedHosts: readonly string[];

  /** True for an http(s) provider URL on an allowed host. */
  isProviderUrl(raw: string): boolean;

  /** Canonical listing URL, or null when the URL is not a listing. */
  parseListingUrl(url: string): string | null;

  /** Discover a listing URL from a place website's anchors. */
  discoverFromWebsiteHtml(html: string, baseUrl: string): string | null;

  /** Build the provider search URL for a place name + address. */
  buildSearchUrl(name: string, address: string | null): string;

  /** Parse candidate listings from a search results page (fetch path). */
  parseSearchResults(html: string, baseUrl: string): RatingSearchCandidate[];

  /** Parse an aggregate rating from listing HTML (fetch path). */
  parseRatingFromHtml(html: string): RawExternalRating | null;

  /** ES5 injected JS for the hidden-WebView listing stage. */
  listingJs: string;

  /** ES5 injected JS for the hidden-WebView search stage. */
  searchJs: string;

  /** Parse a listing-stage WebView message into a raw rating. */
  parseRatingMessage(data: string): RawExternalRating | null;

  /** Parse a search-stage WebView message into candidate listings. */
  parseSearchMessage(data: string): RatingSearchCandidate[] | null;
}
