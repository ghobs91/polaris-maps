import {
  applyFilters,
  compareResults,
  filtersFromIntent,
  isFilterEmpty,
  mergeFilters,
  sortResults,
  type FilterableSearchResult,
} from '../../src/services/search/searchFilters';

function result(overrides: Partial<FilterableSearchResult> = {}): FilterableSearchResult {
  return {
    name: 'Cafe',
    subtitle: 'Main St',
    lat: 0,
    lng: 0,
    type: 'poi',
    osmType: 'amenity',
    osmSubtype: 'cafe',
    score: 50,
    distanceKm: 1,
    ...overrides,
  };
}

describe('applyFilters', () => {
  it('filters by open-now only when the state is known false', () => {
    const results = [result({ openNow: false }), result({ openNow: true }), result({})];
    expect(applyFilters(results, { openNow: true })).toHaveLength(2);
  });

  it('passes through results whose rating is unknown', () => {
    const results = [result({ rating: 3 }), result({ rating: 4.5 }), result({})];
    expect(applyFilters(results, { minRating: 4 })).toHaveLength(2);
  });

  it('filters by price level, passing through unknown prices', () => {
    const results = [result({ priceLevel: 4 }), result({ priceLevel: 2 }), result({})];
    expect(applyFilters(results, { maxPriceLevel: 2 })).toHaveLength(2);
  });

  it('filters by maximum distance', () => {
    const results = [result({ distanceKm: 0.5 }), result({ distanceKm: 5 })];
    expect(applyFilters(results, { maxDistanceKm: 2 })).toHaveLength(1);
  });

  it('filters by category, excluding results without a category', () => {
    const results = [
      result({ osmSubtype: 'cafe' }),
      result({ osmSubtype: 'restaurant' }),
      { ...result(), osmType: undefined, osmSubtype: undefined, type: 'address' },
    ];
    expect(applyFilters(results, { categories: ['cafe'] })).toHaveLength(1);
  });

  it('imposes no constraint when filters are empty', () => {
    const results = [result(), result({ rating: 1 })];
    expect(applyFilters(results, {})).toHaveLength(2);
  });
});

describe('compareResults / sortResults', () => {
  it('sorts by relevance descending with distance tie-break', () => {
    const results = [
      result({ score: 40, distanceKm: 1 }),
      result({ score: 90, distanceKm: 3 }),
      result({ score: 40, distanceKm: 0.5 }),
    ];
    expect(sortResults(results, 'relevance').map((r) => [r.score, r.distanceKm])).toEqual([
      [90, 3],
      [40, 0.5],
      [40, 1],
    ]);
  });

  it('sorts by distance ascending with score tie-break', () => {
    const results = [
      result({ distanceKm: 2, score: 10 }),
      result({ distanceKm: 2, score: 80 }),
      result({ distanceKm: 0.5, score: 5 }),
    ];
    expect(sortResults(results, 'distance').map((r) => r.distanceKm)).toEqual([0.5, 2, 2]);
    expect(sortResults(results, 'distance')[1].score).toBe(80);
  });

  it('sorts by rating and treats unknown ratings as lowest', () => {
    const results = [result({ rating: 3 }), result({}), result({ rating: 5 })];
    expect(sortResults(results, 'rating').map((r) => r.rating)).toEqual([5, 3, undefined]);
  });

  it('sorts by price ascending and treats unknown prices as highest', () => {
    const results = [result({ priceLevel: 3 }), result({}), result({ priceLevel: 1 })];
    expect(sortResults(results, 'price').map((r) => r.priceLevel)).toEqual([1, 3, undefined]);
  });

  it('does not mutate the input array', () => {
    const results = [result({ score: 1 }), result({ score: 9 })];
    const before = [...results];
    sortResults(results, 'relevance');
    expect(results).toEqual(before);
  });
});

describe('intent-seeded filters', () => {
  it('derives filters from intent hints', () => {
    expect(filtersFromIntent({ wantsOpenNow: true, wantsQuality: true, wantsCheap: true })).toEqual(
      {
        openNow: true,
        minRating: 4,
        maxPriceLevel: 2,
      },
    );
    expect(filtersFromIntent({})).toEqual({
      openNow: undefined,
      minRating: undefined,
      maxPriceLevel: undefined,
    });
  });

  it('lets explicit user selections override the seeded defaults', () => {
    const merged = mergeFilters(
      { wantsOpenNow: true, wantsQuality: true },
      { openNow: false, maxDistanceKm: 2 },
    );
    expect(merged.openNow).toBe(false); // user override
    expect(merged.minRating).toBe(4); // from intent
    expect(merged.maxDistanceKm).toBe(2); // explicit only
  });
});

describe('isFilterEmpty', () => {
  it('detects unconstrained vs constrained filters', () => {
    expect(isFilterEmpty({})).toBe(true);
    expect(isFilterEmpty({ categories: [] })).toBe(true);
    expect(isFilterEmpty({ openNow: false })).toBe(false);
    expect(isFilterEmpty({ minRating: 4 })).toBe(false);
  });
});

describe('compareResults', () => {
  it('is a valid comparator (0 for identical)', () => {
    const r = result();
    expect(compareResults(r, r, 'relevance')).toBe(0);
  });
});
