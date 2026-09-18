import { parseGoogleReviewsJson } from '../../src/services/reviews/googleReviewsImport';

const SAMPLE_FEATURE = {
  geometry: { coordinates: [-73.6133761, 40.7316561], type: 'Point' },
  properties: {
    date: '2025-01-07T23:00:13.001902Z',
    five_star_rating_published: 1,
    google_maps_url: 'https://www.google.com/maps/place//data=!4m2!3m1!1s0x0:0xf89b107df7893695',
    location: {
      address: '555 Stewart Ave, Garden City, NY 11530, United States',
      name: 'Florent',
    },
    review_text_published:
      'Not even in the market for an apartment, but had to chime in with everyone else that these prices are delusional.',
  },
  type: 'Feature',
};

function featureCollection(features: unknown[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

describe('parseGoogleReviewsJson', () => {
  it('parses a real-world Reviews.json feature', () => {
    const reviews = parseGoogleReviewsJson(featureCollection([SAMPLE_FEATURE]));
    expect(reviews).toHaveLength(1);
    const [review] = reviews;
    expect(review.name).toBe('Florent');
    expect(review.address).toBe('555 Stewart Ave, Garden City, NY 11530, United States');
    // GeoJSON order is [lng, lat]
    expect(review.lat).toBeCloseTo(40.7316561, 6);
    expect(review.lng).toBeCloseTo(-73.6133761, 6);
    expect(review.rating).toBe(1);
    expect(review.text).toContain('delusional');
    expect(review.createdAt).toBe(Math.floor(Date.parse('2025-01-07T23:00:13.001902Z') / 1000));
    expect(review.googleMapsUrl).toContain('google.com/maps');
  });

  it('accepts a bare array of features', () => {
    const reviews = parseGoogleReviewsJson(JSON.stringify([SAMPLE_FEATURE]));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].name).toBe('Florent');
  });

  it('keeps rating-only reviews (empty text)', () => {
    const feature = {
      ...SAMPLE_FEATURE,
      properties: { ...SAMPLE_FEATURE.properties, review_text_published: '' },
    };
    const reviews = parseGoogleReviewsJson(featureCollection([feature]));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].text).toBeUndefined();
    expect(reviews[0].rating).toBe(1);
  });

  it('skips entries missing a name, coordinates, or valid rating', () => {
    const noName = {
      ...SAMPLE_FEATURE,
      properties: { ...SAMPLE_FEATURE.properties, location: { address: 'x' } },
    };
    const noCoords = { ...SAMPLE_FEATURE, geometry: { type: 'Point', coordinates: [0, 0] } };
    const badRating = {
      ...SAMPLE_FEATURE,
      properties: { ...SAMPLE_FEATURE.properties, five_star_rating_published: 7 },
    };
    const stringRating = {
      ...SAMPLE_FEATURE,
      properties: { ...SAMPLE_FEATURE.properties, five_star_rating_published: '5' },
    };
    const reviews = parseGoogleReviewsJson(
      featureCollection([noName, noCoords, badRating, stringRating, SAMPLE_FEATURE]),
    );
    // '5' coerces to a valid rating; the rest are skipped
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.rating).sort()).toEqual([1, 5]);
  });

  it('truncates over-long review text to the 2000-char review limit', () => {
    const feature = {
      ...SAMPLE_FEATURE,
      properties: { ...SAMPLE_FEATURE.properties, review_text_published: 'x'.repeat(5000) },
    };
    const reviews = parseGoogleReviewsJson(featureCollection([feature]));
    expect(reviews[0].text).toHaveLength(2000);
  });

  it('throws a helpful error for non-JSON input', () => {
    expect(() => parseGoogleReviewsJson('not json')).toThrow(/not valid JSON.*Reviews\.json/);
  });

  it('returns an empty array when no features are usable', () => {
    expect(parseGoogleReviewsJson(featureCollection([]))).toEqual([]);
    expect(parseGoogleReviewsJson(JSON.stringify({ type: 'FeatureCollection' }))).toEqual([]);
  });
});
