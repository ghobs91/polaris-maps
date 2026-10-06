/**
 * Combine per-provider aggregate ratings into one count-weighted summary.
 *
 * When a place has ratings from more than one provider, the combined rating is
 * the review-count-weighted mean and the combined count is the sum of the exact
 * counts. With a single provider the combined values equal that provider's.
 * Providers reporting a zero count fall back to an unweighted mean so a rating
 * is still shown rather than being lost to a divide-by-zero.
 *
 * Only the aggregate numbers cross this boundary — no review text.
 */

import type { ExternalRatingProviderId, ExternalRatingSummary } from './types';

export interface CombinedRating {
  /** Weighted mean rating on a 0–5 scale. */
  rating: number;
  /** Sum of the exact per-provider review counts. */
  reviewCount: number;
  /** Providers that contributed, in input order. */
  sources: ExternalRatingProviderId[];
  /** Most recent observation time across the contributing sources (ms epoch). */
  observedAt: number;
}

function isValid(summary: ExternalRatingSummary): boolean {
  return (
    Number.isFinite(summary.rating) &&
    summary.rating >= 0 &&
    summary.rating <= 5 &&
    Number.isInteger(summary.reviewCount) &&
    summary.reviewCount >= 0
  );
}

/**
 * Combine ratings into a single aggregate, or null when there is nothing valid.
 */
export function combineExternalRatings(
  summaries: readonly ExternalRatingSummary[],
): CombinedRating | null {
  const valid = summaries.filter(isValid);
  if (valid.length === 0) return null;

  const reviewCount = valid.reduce((total, s) => total + s.reviewCount, 0);
  const weightedSum = valid.reduce((total, s) => total + s.rating * s.reviewCount, 0);
  const rating =
    reviewCount > 0
      ? weightedSum / reviewCount
      : valid.reduce((total, s) => total + s.rating, 0) / valid.length;

  return {
    rating: Math.max(0, Math.min(5, rating)),
    reviewCount,
    sources: valid.map((s) => s.provider),
    observedAt: valid.reduce((latest, s) => Math.max(latest, s.observedAt), 0),
  };
}
