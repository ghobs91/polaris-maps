import { providerById, resolveKnownListing } from '../../src/services/poi/externalRatings/index';
import {
  candidatesFromSearchHtml,
  selectSearchCandidate,
} from '../../src/services/poi/externalRatings/search';
import {
  fetchAndParseRating,
  resolveExternalRatings,
} from '../../src/services/poi/externalRatings/index';
import { clearExternalRatingCache } from '../../src/services/poi/externalRatings/core';
import type { ExternalRatingQuery } from '../../src/services/poi/externalRatings/types';

const TA = providerById('tripadvisor');
const YELP = providerById('yelp');

const QUERY: ExternalRatingQuery = {
  name: 'Foo Bar',
  lat: 40.75,
  lng: -73.99,
  address: '123 Main St, New York, NY',
};

function mockFetchOnce(html: string, ok = true) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok,
    text: () => Promise.resolve(html),
  });
}

describe('resolveKnownListing (resolution order)', () => {
  beforeEach(() => clearExternalRatingCache());

  it('prefers an explicit tag and performs no fetch', async () => {
    const fetchSpy = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchSpy;

    const url = await resolveKnownListing(TA, {
      ...QUERY,
      tags: {
        'polaris:tripadvisor':
          'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html',
      },
    });
    expect(url).toBe('https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to a website link when there is no tag', async () => {
    mockFetchOnce('<a href="https://www.yelp.com/biz/foo-bar">Yelp</a>');
    const url = await resolveKnownListing(YELP, { ...QUERY, website: 'foo.com' });
    expect(url).toBe('https://www.yelp.com/biz/foo-bar');
  });

  it('returns null when nothing is discoverable', async () => {
    mockFetchOnce('<html></html>');
    expect(await resolveKnownListing(YELP, { ...QUERY, website: null })).toBeNull();
  });
});

describe('fetchAndParseRating', () => {
  beforeEach(() => clearExternalRatingCache());

  it('validates, caches, and reuses a fetched rating', async () => {
    mockFetchOnce(
      `<script type="application/ld+json">{"@type":"Restaurant","name":"Foo Bar","aggregateRating":{"ratingValue":"4.5","reviewCount":"321"}}</script>`,
    );
    const first = await fetchAndParseRating(YELP, 'https://www.yelp.com/biz/foo-bar', QUERY);
    expect(first?.rating).toBe(4.5);
    expect(first?.reviewCount).toBe(321);
    expect(first?.provider).toBe('yelp');

    const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
    const second = await fetchAndParseRating(YELP, 'https://www.yelp.com/biz/foo-bar', QUERY);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a listing whose name does not match the queried place', async () => {
    mockFetchOnce(
      `<script type="application/ld+json">{"@type":"Restaurant","name":"Some Other Place","aggregateRating":{"ratingValue":"4.5","reviewCount":"321"}}</script>`,
    );
    expect(await fetchAndParseRating(YELP, 'https://www.yelp.com/biz/foo-bar', QUERY)).toBeNull();
  });
});

describe('resolveExternalRatings (fetch-only path)', () => {
  beforeEach(() => clearExternalRatingCache());

  it('collects ratings from providers with a resolvable listing', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockImplementation((url: string) => {
        if (url.includes('foo.com')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('<a href="https://www.yelp.com/biz/foo-bar">Yelp</a>'),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              `<script type="application/ld+json">{"@type":"Restaurant","name":"Foo Bar","aggregateRating":{"ratingValue":"4.2","reviewCount":"100"}}</script>`,
            ),
        });
      });

    const summaries = await resolveExternalRatings({ ...QUERY, website: 'foo.com' });
    expect(summaries.map((s) => s.provider)).toEqual(['yelp']);
    expect(summaries[0]?.rating).toBe(4.2);
  });
});

describe('search selection', () => {
  it('parses candidates from search HTML and picks the identity match', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"searchResults":[{"business":{"alias":"foo-bar-other","name":"Foo Bar","coordinates":{"latitude":40.9,"longitude":-74.1},"location":{"address1":"500 Broadway","city":"Brooklyn","state":"NY"}}},{"business":{"alias":"foo-bar","name":"Foo Bar","coordinates":{"latitude":40.75,"longitude":-73.99},"location":{"address1":"123 Main St","city":"New York","state":"NY"}}}]}}}</script>`;
    const candidates = candidatesFromSearchHtml(YELP, html, 'https://www.yelp.com/search');
    const chosen = selectSearchCandidate(candidates, QUERY);
    expect(chosen?.url).toBe('https://www.yelp.com/biz/foo-bar');
  });

  it('falls back to a name-only candidate (the listing stage re-verifies identity)', () => {
    const candidates = [
      { url: 'https://www.yelp.com/biz/foo-bar', name: 'Foo Bar', address: null, geo: null },
    ];
    expect(selectSearchCandidate(candidates, QUERY)?.url).toBe('https://www.yelp.com/biz/foo-bar');
  });

  it('returns null when no candidate name matches', () => {
    const candidates = [
      { url: 'https://www.yelp.com/biz/other', name: 'Other Place', address: null, geo: null },
    ];
    expect(selectSearchCandidate(candidates, QUERY)).toBeNull();
  });
});
