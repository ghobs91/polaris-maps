/**
 * Shared types for on-device external rating providers (TripAdvisor, Yelp).
 *
 * Only an aggregate rating number, its exact count, the listing identity, and
 * the source URL are ever modelled here. Individual review text and reviewer
 * identities are intentionally out of scope — the app fetches the number only.
 */

export type ExternalRatingProviderId = 'tripadvisor' | 'yelp';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ExternalRatingSummary {
  provider: ExternalRatingProviderId;
  /** Canonical listing URL that was loaded. */
  listingUrl: string;
  /** Listing name as published by the provider. */
  listingName: string;
  /** Optional listing address as published by the provider. */
  listingAddress?: string;
  /** Rating on a 0–5 scale. */
  rating: number;
  /** Exact, non-negative review count. */
  reviewCount: number;
  /** When the rating was observed (ms epoch). */
  observedAt: number;
}

/**
 * Raw, unvalidated extraction shared by the fetch path and the WebView bridge.
 */
export interface RawExternalRating {
  rating: number | null;
  reviewCount: number | null;
  listingName: string | null;
  listingAddress: string | null;
  /** Optional listing coordinates, used for identity confirmation. */
  geo?: GeoPoint | null;
  challenge: boolean;
}

/** The place being looked up. */
export interface ExternalRatingQuery {
  name: string;
  lat: number;
  lng: number;
  /** Assembled address, when available. */
  address?: string | null;
  /** Place website, used to discover a linked listing. */
  website?: string | null;
  /** Raw OSM tags, used for explicit `polaris:<provider>` links. */
  tags?: Record<string, string>;
}

/** A candidate listing parsed from a provider search results page. */
export interface RatingSearchCandidate {
  url: string;
  name: string | null;
  address: string | null;
  geo?: GeoPoint | null;
  /** Aggregate rating shown inline on a search-result card, when available. */
  rating?: number;
  /** Exact review count shown inline on a search-result card. */
  reviewCount?: number;
}
