import { combineExternalRatings } from '../../src/services/poi/externalRatings/combine';
import type { ExternalRatingSummary } from '../../src/services/poi/externalRatings/types';

function summary(
  provider: ExternalRatingSummary['provider'],
  rating: number,
  reviewCount: number,
  observedAt = 1,
): ExternalRatingSummary {
  return {
    provider,
    listingUrl: `https://example.com/${provider}`,
    listingName: 'Foo',
    rating,
    reviewCount,
    observedAt,
  };
}

describe('combineExternalRatings', () => {
  it('weights the mean by review count and sums counts', () => {
    const combined = combineExternalRatings([
      summary('tripadvisor', 4.5, 1000),
      summary('yelp', 3.0, 3000),
    ]);
    expect(combined?.rating).toBeCloseTo(3.375, 5);
    expect(combined?.reviewCount).toBe(4000);
    expect(combined?.sources).toEqual(['tripadvisor', 'yelp']);
  });

  it('equals the provider values when only one has a rating', () => {
    const combined = combineExternalRatings([summary('yelp', 4.2, 321)]);
    expect(combined?.rating).toBe(4.2);
    expect(combined?.reviewCount).toBe(321);
    expect(combined?.sources).toEqual(['yelp']);
  });

  it('falls back to an unweighted mean when all counts are zero', () => {
    const combined = combineExternalRatings([summary('tripadvisor', 4, 0), summary('yelp', 2, 0)]);
    expect(combined?.rating).toBe(3);
    expect(combined?.reviewCount).toBe(0);
  });

  it('returns the most recent observation time', () => {
    const combined = combineExternalRatings([
      summary('tripadvisor', 4, 10, 100),
      summary('yelp', 5, 10, 900),
    ]);
    expect(combined?.observedAt).toBe(900);
  });

  it('ignores invalid entries and returns null when none are valid', () => {
    expect(combineExternalRatings([])).toBeNull();
    const combined = combineExternalRatings([
      { ...summary('tripadvisor', 4.5, 100) },
      { ...summary('yelp', NaN, 50) },
      { ...summary('yelp', 4, -1) },
    ]);
    expect(combined?.sources).toEqual(['tripadvisor']);
    expect(combined?.reviewCount).toBe(100);
  });
});
