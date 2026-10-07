/**
 * placePhotoCache tests — uses an in-memory MMKV stub to stay hermetic.
 */

jest.mock('../../src/services/storage/mmkv', () => {
  const store = new Map<string, string>();
  return {
    storage: {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      delete: (key: string) => store.delete(key),
    },
  };
});

import {
  clearPlacePhotoCache,
  getCachedPlacePhotos,
  setCachedPlacePhotos,
  MAX_PLACE_PHOTOS,
} from '../../src/services/places/placePhotoCache';

const URL = 'https://cafe.example/';

describe('placePhotoCache', () => {
  beforeEach(() => {
    clearPlacePhotoCache();
    jest.restoreAllMocks();
  });

  it('stores and returns photo URLs', () => {
    setCachedPlacePhotos(URL, ['https://cafe.example/a.jpg', 'https://cafe.example/b.jpg']);
    expect(getCachedPlacePhotos(URL)).toEqual([
      'https://cafe.example/a.jpg',
      'https://cafe.example/b.jpg',
    ]);
  });

  it('caps the number of stored photos', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://cafe.example/${i}.jpg`);
    setCachedPlacePhotos(URL, urls);
    expect(getCachedPlacePhotos(URL)).toHaveLength(MAX_PLACE_PHOTOS);
  });

  it('expires stale entries after the TTL', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    setCachedPlacePhotos(URL, ['https://cafe.example/a.jpg']);
    spy.mockReturnValue(now + 61 * 24 * 60 * 60 * 1000);
    expect(getCachedPlacePhotos(URL)).toBeNull();
  });

  it('keeps entries that are within the 2-month TTL', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    setCachedPlacePhotos(URL, ['https://cafe.example/a.jpg']);
    spy.mockReturnValue(now + 59 * 24 * 60 * 60 * 1000);
    expect(getCachedPlacePhotos(URL)).toEqual(['https://cafe.example/a.jpg']);
  });

  it('returns null for unknown pages and clears on demand', () => {
    expect(getCachedPlacePhotos(URL)).toBeNull();
    setCachedPlacePhotos(URL, ['https://cafe.example/a.jpg']);
    clearPlacePhotoCache();
    expect(getCachedPlacePhotos(URL)).toBeNull();
  });

  it('negative-caches empty results so photoless sites are not re-scraped', () => {
    setCachedPlacePhotos(URL, []);
    expect(getCachedPlacePhotos(URL)).toEqual([]);
  });
});
