import {
  countHelpful,
  filterReviews,
  mergeRatings,
  sortReviews,
} from '../../src/services/poi/reviewRanking';
import type { Review } from '../../src/models/review';

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    poiUuid: 'place',
    authorPubkey: 'a',
    rating: 4,
    signature: '',
    createdAt: 1,
    updatedAt: 1,
    source: 'anonymous',
    ...overrides,
  };
}

describe('mergeRatings', () => {
  it('averages valid ratings and counts them', () => {
    expect(mergeRatings([review({ rating: 5 }), review({ rating: 4 })])).toEqual({
      average: 4.5,
      count: 2,
    });
  });

  it('rounds to one decimal', () => {
    expect(
      mergeRatings([review({ rating: 5 }), review({ rating: 4 }), review({ rating: 4 })]),
    ).toEqual({ average: 4.3, count: 3 });
  });

  it('ignores out-of-range ratings and handles empty input', () => {
    expect(mergeRatings([])).toEqual({ average: 0, count: 0 });
    expect(mergeRatings([review({ rating: 0 }), review({ rating: 6 })])).toEqual({
      average: 0,
      count: 0,
    });
  });
});

describe('filterReviews', () => {
  it('filters by minimum rating', () => {
    const reviews = [review({ id: 'a', rating: 2 }), review({ id: 'b', rating: 5 })];
    expect(filterReviews(reviews, { minRating: 4 }).map((r) => r.id)).toEqual(['b']);
  });

  it('filters to reviews with photos', () => {
    const reviews = [
      review({ id: 'a', media: [] }),
      review({
        id: 'b',
        media: [
          { hash: 'h', width: 1, height: 1, mime: 'image/jpeg', status: 'local', createdAt: 1 },
        ],
      }),
    ];
    expect(filterReviews(reviews, { photosOnly: true }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('sortReviews', () => {
  const reviews = [
    review({ id: 'old', rating: 3, createdAt: 100, helpfulCount: 0 }),
    review({ id: 'new', rating: 5, createdAt: 300, helpfulCount: 1 }),
    review({ id: 'mid', rating: 4, createdAt: 200, helpfulCount: 5 }),
  ];

  it('sorts newest first', () => {
    expect(sortReviews(reviews, 'newest').map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts highest and lowest by rating', () => {
    expect(sortReviews(reviews, 'highest')[0].id).toBe('new');
    expect(sortReviews(reviews, 'lowest')[0].id).toBe('old');
  });

  it('sorts by most helpful', () => {
    expect(sortReviews(reviews, 'most_helpful').map((r) => r.id)).toEqual(['mid', 'new', 'old']);
  });

  it('does not mutate the input', () => {
    const before = reviews.map((r) => r.id);
    sortReviews(reviews, 'highest');
    expect(reviews.map((r) => r.id)).toEqual(before);
  });
});

describe('countHelpful', () => {
  it('counts unique voters (one vote per identity)', () => {
    expect(countHelpful(['a', 'a', 'b', 'c', 'b'])).toBe(3);
    expect(countHelpful([])).toBe(0);
  });
});
