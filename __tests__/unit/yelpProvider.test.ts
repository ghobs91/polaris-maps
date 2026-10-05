import {
  buildYelpSearchUrl,
  canonicalYelpListingUrl,
  discoverYelpFromWebsiteHtml,
  extractYelpRatingFromWebViewMessage,
  isAllowedYelpHost,
  isYelpUrl,
  parseYelpNextDataRating,
  parseYelpRatingFromHtml,
  parseYelpSearchResults,
  resolveYelpUrl,
} from '../../src/services/poi/externalRatings/yelpProvider';

describe('Yelp host allowlist + URL validation', () => {
  it('accepts only yelp.com hosts', () => {
    expect(isAllowedYelpHost('yelp.com')).toBe(true);
    expect(isAllowedYelpHost('www.yelp.com')).toBe(true);
    expect(isAllowedYelpHost('yelp.ca')).toBe(false);
    expect(isAllowedYelpHost('notyelp.com')).toBe(false);
  });

  it('isYelpUrl requires an allowed host + http(s) scheme', () => {
    expect(isYelpUrl('https://www.yelp.com/biz/foo-bar')).toBe(true);
    expect(isYelpUrl('ftp://yelp.com/biz/foo')).toBe(false);
    expect(isYelpUrl('https://evil-yelp.com/biz/foo')).toBe(false);
  });

  it('canonicalizes /biz/ listings and rejects non-listings', () => {
    expect(canonicalYelpListingUrl('https://www.yelp.com/biz/foo-bar?utm_source=x#photos')).toBe(
      'https://www.yelp.com/biz/foo-bar',
    );
    expect(canonicalYelpListingUrl('https://www.yelp.com/search?find_desc=foo')).toBeNull();
    expect(canonicalYelpListingUrl('https://example.com/biz/foo')).toBeNull();
  });
});

describe('resolveYelpUrl / discoverYelpFromWebsiteHtml', () => {
  it('prefers an explicit polaris:yelp tag', () => {
    expect(
      resolveYelpUrl({
        name: 'Foo',
        tags: { 'polaris:yelp': 'https://www.yelp.com/biz/foo-bar' },
      }),
    ).toBe('https://www.yelp.com/biz/foo-bar');
  });

  it('discovers a Yelp link among other anchors', () => {
    const html = [
      '<a href="https://facebook.com/foo">Facebook</a>',
      '<a href="https://www.yelp.com/biz/foo-bar">Yelp</a>',
    ].join('\n');
    expect(discoverYelpFromWebsiteHtml(html, 'https://foo.com/')).toBe(
      'https://www.yelp.com/biz/foo-bar',
    );
  });
});

describe('parseYelpRatingFromHtml', () => {
  it('extracts aggregateRating from JSON-LD', () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Restaurant","name":"Foo Bar","aggregateRating":{"ratingValue":"4.5","reviewCount":"321"}}
      </script>`;
    const raw = parseYelpRatingFromHtml(html);
    expect(raw?.rating).toBe(4.5);
    expect(raw?.reviewCount).toBe(321);
    expect(raw?.listingName).toBe('Foo Bar');
  });

  it('extracts from the embedded __NEXT_DATA__ script', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"business":{"name":"Foo Bar","rating":4.5,"reviewCount":321,"coordinates":{"latitude":40.75,"longitude":-73.99},"location":{"address1":"123 Main St","city":"New York","state":"NY"}}}}}</script>`;
    const raw = parseYelpNextDataRating(html);
    expect(raw?.rating).toBe(4.5);
    expect(raw?.reviewCount).toBe(321);
    expect(raw?.listingName).toBe('Foo Bar');
    expect(raw?.geo).toEqual({ lat: 40.75, lng: -73.99 });
  });

  it('falls back to the DOM when structured data is absent', () => {
    const html = '<div aria-label="3.9 star rating"></div><span>1,204 reviews</span>';
    const raw = parseYelpRatingFromHtml(html);
    expect(raw?.rating).toBe(3.9);
    expect(raw?.reviewCount).toBe(1204);
  });

  it('returns null on challenge pages and missing data', () => {
    expect(
      parseYelpRatingFromHtml(
        '<html><body><div id="datadome">verify you are human</div></body></html>',
      ),
    ).toBeNull();
    expect(parseYelpRatingFromHtml('<html><body>nothing here</body></html>')).toBeNull();
  });
});

describe('parseYelpSearchResults', () => {
  it('reads structured businesses from __NEXT_DATA__', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"searchResults":[{"business":{"alias":"foo-bar","name":"Foo Bar","coordinates":{"latitude":40.75,"longitude":-73.99},"location":{"address1":"123 Main St","city":"New York","state":"NY"}}}]}}}</script>`;
    const candidates = parseYelpSearchResults(html, 'https://www.yelp.com/search');
    expect(candidates[0]?.url).toBe('https://www.yelp.com/biz/foo-bar');
    expect(candidates[0]?.name).toBe('Foo Bar');
    expect(candidates[0]?.address).toBe('123 Main St, New York, NY');
    expect(candidates[0]?.geo).toEqual({ lat: 40.75, lng: -73.99 });
  });

  it('falls back to /biz/ anchors', () => {
    const html = '<a href="/biz/foo-bar-cafe">Foo Bar Cafe</a>';
    const candidates = parseYelpSearchResults(html, 'https://www.yelp.com/search');
    expect(candidates).toEqual([
      {
        url: 'https://www.yelp.com/biz/foo-bar-cafe',
        name: 'Foo Bar Cafe',
        address: null,
        geo: null,
      },
    ]);
  });
});

describe('buildYelpSearchUrl + WebView message parsing', () => {
  it('builds a name + address search URL', () => {
    expect(buildYelpSearchUrl('Foo Bar', '123 Main St')).toBe(
      'https://www.yelp.com/search?find_desc=Foo+Bar&find_loc=123+Main+St',
    );
    expect(buildYelpSearchUrl('Foo Bar', null)).toBe(
      'https://www.yelp.com/search?find_desc=Foo+Bar',
    );
  });

  it('parses a Yelp listing WebView payload', () => {
    const raw = extractYelpRatingFromWebViewMessage(
      JSON.stringify({
        type: 'external-rating',
        provider: 'yelp',
        ldRating: 4.5,
        ldCount: 321,
        ldName: 'Foo Bar',
        ldAddress: '123 Main St',
        geo: { lat: 40.75, lng: -73.99 },
        automation: [],
        challenge: false,
      }),
    );
    expect(raw?.rating).toBe(4.5);
    expect(raw?.reviewCount).toBe(321);
  });

  it('rejects payloads for another provider', () => {
    expect(
      extractYelpRatingFromWebViewMessage(
        JSON.stringify({
          type: 'external-rating',
          provider: 'tripadvisor',
          ldRating: 4,
          ldCount: 1,
        }),
      ),
    ).toBeNull();
  });
});
