import {
  clearExternalRatingCache,
  fetchAndParseRating,
} from '../../src/services/poi/externalRatings';
import {
  COLLECTOR_INITIAL_DELAY_MS,
  COLLECTOR_MAX_ATTEMPTS,
  COLLECTOR_RETRY_INTERVAL_MS,
  isHardBlockPage,
} from '../../src/services/poi/externalRatings/core';
import { yelpProvider } from '../../src/services/poi/externalRatings/yelpProvider';
import {
  TRIPADVISOR_RATING_JS,
  TRIPADVISOR_SEARCH_JS,
  tripadvisorProvider,
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
    supportsPlainFetch: true,
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
    const lastAttemptAt =
      COLLECTOR_INITIAL_DELAY_MS + (COLLECTOR_MAX_ATTEMPTS - 1) * COLLECTOR_RETRY_INTERVAL_MS;
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
      expect(script).toContain(`var FIRST_DELAY = ${COLLECTOR_INITIAL_DELAY_MS};`);
    }
  });
});

function runTripadvisorCollector(blocks: unknown[]): Array<Record<string, unknown>> {
  const posted: string[] = [];
  const scripts = blocks.map((b) => ({ textContent: JSON.stringify(b) }));
  const fakeDocument = {
    title: '',
    body: { innerHTML: '', innerText: '' },
    querySelectorAll: (selector: string) =>
      selector === 'script[type="application/ld+json"]' ? scripts : [],
  };
  const fakeWindow = { ReactNativeWebView: { postMessage: (s: string) => posted.push(s) } };
  const run = new Function('window', 'document', 'setTimeout', TRIPADVISOR_RATING_JS) as (
    w: unknown,
    d: unknown,
    s: (cb: () => void) => unknown,
  ) => void;
  run(fakeWindow, fakeDocument, (cb) => cb());
  return posted.map((p) => JSON.parse(p) as Record<string, unknown>);
}

describe('Tripadvisor listing collector', () => {
  it('uses the object with aggregateRating when earlier blocks are named', () => {
    const posted = runTripadvisorCollector([
      {},
      { '@type': 'VideoObject', name: "Antonio's Real New York Pizza" },
      {
        '@type': 'FoodEstablishment',
        name: "Antonio's Real New York Pizza",
        aggregateRating: { ratingValue: '4.5', reviewCount: '1449' },
        geo: { latitude: 40.37, longitude: -105.52 },
        address: { streetAddress: '123 W Elkhorn Ave' },
      },
      { '@type': 'LocalBusiness', name: 'Top of the World Tour' },
    ]);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      ldRating: 4.5,
      ldCount: 1449,
      ldName: "Antonio's Real New York Pizza",
    });
  });
});

describe('hard block detection', () => {
  it('recognizes the terminal Yelp/DataDome block page', () => {
    expect(
      isHardBlockPage(
        '<html><body>You have been blocked. Why? Something about the behaviour of the browser has caught our attention.</body></html>',
      ),
    ).toBe(true);
  });

  it('does not treat a normal listing as blocked', () => {
    expect(isHardBlockPage('<html><body>4.5 stars · 321 reviews</body></html>')).toBe(false);
  });
});

describe('browser-only providers', () => {
  beforeEach(() => {
    clearExternalRatingCache();
    mockFetchHtml();
  });

  it('never issues a plain fetch to either provider', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    const yelp = await fetchAndParseRating(yelpProvider, 'https://www.yelp.com/biz/foo-bar', QUERY);
    const tripadvisor = await fetchAndParseRating(tripadvisorProvider, LISTING, QUERY);
    expect(yelp).toBeNull();
    expect(tripadvisor).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks both providers browser-only', () => {
    expect(yelpProvider.supportsPlainFetch).toBe(false);
    expect(tripadvisorProvider.supportsPlainFetch).toBe(false);
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
