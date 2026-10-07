import {
  clearSessionPlaceRatings,
  getSessionPlaceRating,
  placeRatingKey,
  setSessionPlaceRating,
  subscribeSessionPlaceRatings,
} from '../../src/services/places/placeRatingSessionCache';

const rating = (value: number) => ({
  rating: value,
  reviewCount: 100,
  sources: ['tripadvisor' as const],
  observedAt: 1_700_000_000_000,
});

describe('placeRatingSessionCache', () => {
  beforeEach(() => {
    clearSessionPlaceRatings();
  });

  it('builds a stable key from normalized name and rounded coordinates', () => {
    expect(placeRatingKey({ name: '  Foo   Bar ', lat: 40.751234, lng: -73.991234 })).toBe(
      'foo bar|40.75123,-73.99123',
    );
  });

  it('returns null for an unknown key and the stored value afterwards', () => {
    const key = placeRatingKey({ name: 'Foo Bar', lat: 40.75, lng: -73.99 });
    expect(getSessionPlaceRating(key)).toBeNull();
    setSessionPlaceRating(key, rating(4.5));
    expect(getSessionPlaceRating(key)?.rating).toBe(4.5);
  });

  it('notifies subscribers when a new rating is stored', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSessionPlaceRatings(listener);
    setSessionPlaceRating(placeRatingKey({ name: 'Foo', lat: 1, lng: 2 }), rating(4));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not notify when the same rating is stored again', () => {
    const key = placeRatingKey({ name: 'Foo', lat: 1, lng: 2 });
    setSessionPlaceRating(key, rating(4));
    const listener = jest.fn();
    subscribeSessionPlaceRatings(listener);
    setSessionPlaceRating(key, rating(4));
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies and clears on demand', () => {
    const key = placeRatingKey({ name: 'Foo', lat: 1, lng: 2 });
    setSessionPlaceRating(key, rating(4));
    const listener = jest.fn();
    subscribeSessionPlaceRatings(listener);
    clearSessionPlaceRatings();
    expect(getSessionPlaceRating(key)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
