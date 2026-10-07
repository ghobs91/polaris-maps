jest.mock('../../src/services/database/init', () => {
  const db = { getFirstAsync: jest.fn() };
  return { getDatabase: jest.fn().mockResolvedValue(db), __mockDb: db };
});

jest.mock('../../src/services/poi/poiService', () => ({
  findPlaceIdNear: jest.fn(),
}));

import { findPlaceIdNear } from '../../src/services/poi/poiService';
import {
  clearPlaceReviewSummaryCache,
  loadPlaceReviewSummaries,
} from '../../src/services/places/placeReviewSummaryService';
import {
  clearSessionPlaceRatings,
  placeRatingKey,
  setSessionPlaceRating,
} from '../../src/services/places/placeRatingSessionCache';
import type { SavedPlace } from '../../src/models/placeList';

const mockFindPlaceIdNear = findPlaceIdNear as jest.Mock;
const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getFirstAsync: jest.Mock };
};

function place(overrides: Partial<SavedPlace>): SavedPlace {
  return { id: 'p1', name: 'Foo Bar', lat: 40.75, lng: -73.99, addedAt: 1, ...overrides };
}

describe('loadPlaceReviewSummaries', () => {
  beforeEach(() => {
    clearPlaceReviewSummaryCache();
    clearSessionPlaceRatings();
    jest.clearAllMocks();
    mockDb.getFirstAsync.mockResolvedValue(null);
    mockFindPlaceIdNear.mockResolvedValue(null);
  });

  it('uses an already-resolved external rating without touching the database', async () => {
    const p = place({});
    setSessionPlaceRating(placeRatingKey(p), {
      rating: 4.5,
      reviewCount: 2345,
      sources: ['tripadvisor', 'yelp'],
      observedAt: 1,
    });

    const result = await loadPlaceReviewSummaries([p]);
    expect(result.p1).toEqual({
      rating: 4.5,
      count: 2345,
      source: 'external',
      providers: ['tripadvisor', 'yelp'],
    });
    expect(mockFindPlaceIdNear).not.toHaveBeenCalled();
  });

  it('reads the community aggregate for a locally-known place', async () => {
    mockFindPlaceIdNear.mockResolvedValue('uuid-1');
    mockDb.getFirstAsync.mockResolvedValue({ avg_rating: 4.23, review_count: 12 });

    const result = await loadPlaceReviewSummaries([place({})]);
    expect(result.p1).toEqual({
      rating: 4.2,
      count: 12,
      source: 'community',
      providers: [],
    });
  });

  it('omits places with no reviews or no local match', async () => {
    mockFindPlaceIdNear.mockResolvedValue('uuid-1');
    mockDb.getFirstAsync.mockResolvedValue({ avg_rating: 4.5, review_count: 0 });
    await expect(loadPlaceReviewSummaries([place({})])).resolves.toEqual({});

    jest.clearAllMocks();
    mockFindPlaceIdNear.mockResolvedValue(null);
    await expect(loadPlaceReviewSummaries([place({ id: 'p2' })])).resolves.toEqual({});
  });

  it('skips places without coordinates', async () => {
    const result = await loadPlaceReviewSummaries([place({ lat: 0, lng: 0 })]);
    expect(result).toEqual({});
    expect(mockFindPlaceIdNear).not.toHaveBeenCalled();
  });

  it('caches community lookups across calls', async () => {
    mockFindPlaceIdNear.mockResolvedValue('uuid-1');
    mockDb.getFirstAsync.mockResolvedValue({ avg_rating: 4, review_count: 3 });

    await loadPlaceReviewSummaries([place({})]);
    await loadPlaceReviewSummaries([place({})]);
    expect(mockFindPlaceIdNear).toHaveBeenCalledTimes(1);
  });
});
