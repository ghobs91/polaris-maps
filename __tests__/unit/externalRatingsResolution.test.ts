import {
  clearExternalRatingCache,
  fetchAndParseRating,
} from '../../src/services/poi/externalRatings';
import {
  COLLECTOR_MAX_ATTEMPTS,
  COLLECTOR_RETRY_INTERVAL_MS,
} from '../../src/services/poi/externalRatings/core';
import {
  TRIPADVISOR_RATING_JS,
  TRIPADVISOR_SEARCH_JS,
} from '../../src/services/poi/externalRatings/tripadvisorProvider';
import {
  YELP_RATING_JS,
  YELP_SEARCH_JS,
} from '../../src/services/poi/externalRatings/yelpProvider';
import type { ExternalRatingProvider } from '../../src/services/poi/externalRatings/provider';
import type { ExternalRatingQuery } from '../../src/services/poi/externalRatings/types';

const QUERY: ExternalRatingQuery = {
  name: 'Foo Bar',
  lat: 40.75,
  lng: -73.99,
  address: '123 Main St, New York',
  website: null,
  tags: {},
};

const LISTING = 'https://www.tripadvisor.com/Restaurant_Review-g1-d1-Review-Foo-Bar.html';

function fakeProvider(overrides: Partial<ExternalRatingProvider> = {}): ExternalRatingProvider {
  return {
    id: 'tripadvisor',
    allowedHosts: ['tripadvisor.com'],
    isProviderUrl: () => true,
    parseListingUrl: () => LISTING,
    discoverFromWebsiteHtml: () => null,
    buildSearchUrl: () => 'https://www.tripadvisor.com/Search',
    parseSearchResults: () => [],
    parseRatingFromHtml: () => ({
      rating: 4.5,
      reviewCount: 98,
      listingName: 'Foo Bar',
      listingAddress: '123 Main St, New York',
      geo: { lat: 40.75, lng: -73.99 },
      challenge: false,
    }),
    listingJs: TRIPADVISOR_RATING_JS,
    searchJs: TRIPADVISOR_SEARCH_JS,
    parseRatingMessage: () => null,
    parseSearchMessage: () => null,
    ...overrides,
  } as ExternalRatingProvider;
}

function mockFetchHtml(): void {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: () => Promise.resolve('<html><body>listing</body></html>'),
  });
}

describe('collector pacing budget', () => {
  it('posts its verdict before the stage clock unmounts the WebView', () => {
    // STAGE_TIMEOUT_MS in useExternalRatings is 8_000; the collector's last
    // attempt must land inside that window or the stage never hears its verdict.
    const lastAttemptAt = (COLLECTOR_MAX_ATTEMPTS - 1) * COLLECTOR_RETRY_INTERVAL_MS;
    expect(lastAttemptAt).toBeLessThan(8_000);
    expect(8_000 - lastAttemptAt).toBeGreaterThanOrEqual(1_000);
  });

  it('is the pacing every provider script actually ships', () => {
    for (const script of [
      TRIPADVISOR_RATING_JS,
      TRIPADVISOR_SEARCH_JS,
      YELP_RATING_JS,
      YELP_SEARCH_JS,
    ]) {
      expect(script).toContain(`var ATTEMPTS = ${COLLECTOR_MAX_ATTEMPTS};`);
      expect(script).toContain(`var INTERVAL = ${COLLECTOR_RETRY_INTERVAL_MS};`);
    }
  });
});

describe('fetchAndParseRating identity confirmation', () => {
  beforeEach(() => {
    clearExternalRatingCache();
    mockFetchHtml();
  });

  it('accepts a listing whose address confirms the place', async () => {
    const summary = await fetchAndParseRating(fakeProvider(), LISTING, QUERY, {
      confirmIdentity: true,
    });
    expect(summary?.rating).toBe(4.5);
    expect(summary?.reviewCount).toBe(98);
  });

  it('rejects a search-found listing for a different branch of the same chain', async () => {
    const provider = fakeProvider({
      parseRatingFromHtml: () => ({
        rating: 4.5,
        reviewCount: 98,
        listingName: 'Foo Bar',
        listingAddress: '999 Other Rd, Boston',
        geo: { lat: 42.36, lng: -71.06 },
        challenge: false,
      }),
    });

    const summary = await fetchAndParseRating(provider, LISTING, QUERY, { confirmIdentity: true });
    expect(summary).toBeNull();
  });

  it('accepts the same listing on the trusted (tag/website) path', async () => {
    const provider = fakeProvider({
      parseRatingFromHtml: () => ({
        rating: 4.5,
        reviewCount: 98,
        listingName: 'Foo Bar',
        listingAddress: '999 Other Rd, Boston',
        geo: null,
        challenge: false,
      }),
    });

    const summary = await fetchAndParseRating(provider, LISTING, QUERY);
    expect(summary?.rating).toBe(4.5);
  });
});
