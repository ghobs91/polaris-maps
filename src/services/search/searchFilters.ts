import type { UnifiedSearchResult } from './unifiedSearch';

/** User-selectable result filters. Absent keys impose no constraint. */
export interface SearchFilters {
  /** Only places known to be open now. Unknown open-state passes through. */
  openNow?: boolean;
  /** Minimum average rating; results without a rating pass through. */
  minRating?: number;
  /** Maximum price level (1–4); results without a price pass through. */
  maxPriceLevel?: number;
  /** Maximum distance from the search reference point, in km. */
  maxDistanceKm?: number;
  /** Selected category keys (matched against osmType/osmSubtype). */
  categories?: string[];
}

export type SortOption = 'relevance' | 'distance' | 'rating' | 'price';

/**
 * Search result optionally carrying richer data used by filters/sort. Missing
 * fields are treated as "unknown" and never exclude a result.
 */
export type FilterableSearchResult = UnifiedSearchResult & {
  rating?: number;
  priceLevel?: number;
  openNow?: boolean;
};

export interface SearchIntentHints {
  wantsOpenNow?: boolean;
  wantsQuality?: boolean;
  wantsCheap?: boolean;
}

function matchesCategory(result: FilterableSearchResult, categories: string[]): boolean {
  if (result.osmType == null && result.osmSubtype == null) return false;
  const wanted = categories.map((c) => c.toLowerCase());
  const type = result.osmType?.toLowerCase();
  const subtype = result.osmSubtype?.toLowerCase();
  return wanted.some((c) => c === type || c === subtype);
}

/**
 * Apply filters. Numeric/boolean predicates only exclude a result when the
 * relevant datum is known — unknown data passes through so partially-enriched
 * results are never silently hidden.
 */
export function applyFilters<T extends FilterableSearchResult>(
  results: readonly T[],
  filters: SearchFilters,
): T[] {
  return results.filter((result) => {
    if (filters.openNow && result.openNow === false) return false;

    if (filters.minRating != null && result.rating != null && result.rating < filters.minRating) {
      return false;
    }
    if (
      filters.maxPriceLevel != null &&
      result.priceLevel != null &&
      result.priceLevel > filters.maxPriceLevel
    ) {
      return false;
    }
    if (filters.maxDistanceKm != null && result.distanceKm > filters.maxDistanceKm) {
      return false;
    }
    if (filters.categories && filters.categories.length > 0) {
      if (!matchesCategory(result, filters.categories)) return false;
    }
    return true;
  });
}

/** Compare two results for the given sort option, with distance tie-breaks. */
export function compareResults(
  a: FilterableSearchResult,
  b: FilterableSearchResult,
  sort: SortOption,
): number {
  switch (sort) {
    case 'distance':
      return a.distanceKm - b.distanceKm || b.score - a.score;
    case 'rating': {
      const diff = (b.rating ?? -1) - (a.rating ?? -1);
      return diff || a.distanceKm - b.distanceKm;
    }
    case 'price': {
      const diff = (a.priceLevel ?? Infinity) - (b.priceLevel ?? Infinity);
      return diff || a.distanceKm - b.distanceKm;
    }
    case 'relevance':
    default:
      return b.score - a.score || a.distanceKm - b.distanceKm;
  }
}

export function sortResults<T extends FilterableSearchResult>(
  results: readonly T[],
  sort: SortOption,
): T[] {
  return [...results].sort((a, b) => compareResults(a, b, sort));
}

/** Filters implied by natural-language intent (open now, quality, cheap). */
export function filtersFromIntent(intent: SearchIntentHints): SearchFilters {
  return {
    openNow: intent.wantsOpenNow ? true : undefined,
    minRating: intent.wantsQuality ? 4 : undefined,
    maxPriceLevel: intent.wantsCheap ? 2 : undefined,
  };
}

/**
 * Effective filters: explicit user selections win, otherwise fall back to the
 * intent-derived defaults. Distance and category filters are always explicit.
 */
export function mergeFilters(intent: SearchIntentHints, user: SearchFilters): SearchFilters {
  const seeded = filtersFromIntent(intent);
  return {
    openNow: user.openNow ?? seeded.openNow,
    minRating: user.minRating ?? seeded.minRating,
    maxPriceLevel: user.maxPriceLevel ?? seeded.maxPriceLevel,
    maxDistanceKm: user.maxDistanceKm,
    categories: user.categories,
  };
}

/** True when no filter imposes any constraint. */
export function isFilterEmpty(filters: SearchFilters): boolean {
  return (
    filters.openNow == null &&
    filters.minRating == null &&
    filters.maxPriceLevel == null &&
    filters.maxDistanceKm == null &&
    (filters.categories == null || filters.categories.length === 0)
  );
}
