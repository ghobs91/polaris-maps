import type { Review } from '../../models/review';

export type ReviewSortOption = 'newest' | 'highest' | 'lowest' | 'most_helpful';

export interface ReviewFilter {
  minRating?: number;
  photosOnly?: boolean;
}

export interface MergedRating {
  /** Average rating rounded to one decimal (0 when there are no reviews). */
  average: number;
  /** Number of reviews contributing to the average. */
  count: number;
}

/** Merge community ratings into a single average + count. */
export function mergeRatings(reviews: readonly Review[]): MergedRating {
  const valid = reviews.filter((r) => Number.isFinite(r.rating) && r.rating >= 1 && r.rating <= 5);
  if (valid.length === 0) return { average: 0, count: 0 };
  const sum = valid.reduce((total, r) => total + r.rating, 0);
  return { average: Math.round((sum / valid.length) * 10) / 10, count: valid.length };
}

export function filterReviews(reviews: readonly Review[], filter: ReviewFilter): Review[] {
  return reviews.filter((review) => {
    if (filter.minRating != null && review.rating < filter.minRating) return false;
    if (filter.photosOnly && !(review.media && review.media.length > 0)) return false;
    return true;
  });
}

/** Sort reviews; ties fall back to newest first for determinism. */
export function sortReviews(reviews: readonly Review[], option: ReviewSortOption): Review[] {
  return [...reviews].sort((a, b) => {
    switch (option) {
      case 'highest':
        return b.rating - a.rating || b.createdAt - a.createdAt;
      case 'lowest':
        return a.rating - b.rating || b.createdAt - a.createdAt;
      case 'most_helpful':
        return (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0) || b.createdAt - a.createdAt;
      case 'newest':
      default:
        return b.createdAt - a.createdAt;
    }
  });
}

/** Count unique helpful voters (one vote per identity). */
export function countHelpful(voterIds: readonly string[]): number {
  return new Set(voterIds).size;
}
