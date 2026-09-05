import {
  discoverTripadvisorFromWebsiteHtml,
  extractRatingFromWebViewMessage,
  isAllowedTripadvisorHost,
  isTripadvisorUrl,
  namesMatch,
  parseExactCount,
  parseExternalRatingFromHtml,
  parseTripadvisorListingUrl,
  resolveTripadvisorUrl,
  resolveRatingSource,
  validateExternalRating,
  clearTripadvisorRatingCache,
  type RawExternalRating,
} from '../../src/services/poi/tripadvisorService';

describe('host allowlist + URL validation', () => {
  it('accepts only the primary tripadvisor.com hosts', () => {
    expect(isAllowedTripadvisorHost('tripadvisor.com')).toBe(true);
    expect(isAllowedTripadvisorHost('www.tripadvisor.com')).toBe(true);
    // Country variants are intentionally excluded until separately reviewed.
    expect(isAllowedTripadvisorHost('tripadvisor.co.jp')).toBe(false);
    expect(isAllowedTripadvisorHost('tripadvisor.co.uk')).toBe(false);
    expect(isAllowedTripadvisorHost('nottripadvisor.com')).toBe(false);
  });

  it('isTripadvisorUrl requires an allowed host + http(s) scheme', () => {
    expect(
      isTripadvisorUrl('https://www.tripadvisor.com/Restaurant_Review-g1-d1-Review-x.html'),
    ).toBe(true);
    expect(isTripadvisorUrl('http://tripadvisor.com/Attraction-123')).toBe(true);
    expect(isTripadvisorUrl('ftp://tripadvisor.com/x')).toBe(false);
    expect(isTripadvisorUrl('javascript:alert(1)')).toBe(false);
    expect(isTripadvisorUrl('https://evil-tripadvisor.com/Restaurant-1')).toBe(false);
  });
});

describe('parseTripadvisorListingUrl', () => {
  it('parses a Restaurant review URL with place id and type', () => {
    const info = parseTripadvisorListingUrl(
      'https://www.tripadvisor.com/Restaurant_Review-g155043-d8505471-Review-Bluestone_Lane-New_York_City_New_York.html',
    );
    expect(info).not.toBeNull();
    expect(info?.listingType).toBe('Restaurant');
    expect(info?.placeId).toBe('8505471');
  });

  it('parses Attraction and Hotel listing URLs', () => {
    expect(
      parseTripadvisorListingUrl(
        'https://www.tripadvisor.com/Attraction_Review-d123456-Review-Observatory',
      )?.listingType,
    ).toBe('Attraction');
    expect(
      parseTripadvisorListingUrl(
        'https://www.tripadvisor.com/Hotel_Review-d98765-Review-New_York_Hotel',
      )?.listingType,
    ).toBe('Hotel');
  });

  it('rejects non-listing and non-allowed-host URLs', () => {
    expect(parseTripadvisorListingUrl('https://www.tripadvisor.com/Search')).toBeNull();
    expect(parseTripadvisorListingUrl('https://example.com/Restaurant-1')).toBeNull();
  });
});

describe('resolveTripadvisorUrl', () => {
  it('prefers an explicit polaris:tripadvisor tag', () => {
    const url = resolveTripadvisorUrl({
      name: 'Foo',
      tags: {
        'polaris:tripadvisor':
          'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-NYC.html',
      },
    });
    expect(url).toBe('https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-NYC.html');
  });

  it('prefers an explicit override over the tag', () => {
    const url = resolveTripadvisorUrl(
      {
        name: 'Foo',
        tags: {
          'polaris:tripadvisor':
            'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-NYC.html',
        },
      },
      {
        overrideUrl: 'https://www.tripadvisor.com/Attraction_Review-g2-d456-Review-Bar-Boston.html',
      },
    );
    expect(url).toBe(
      'https://www.tripadvisor.com/Attraction_Review-g2-d456-Review-Bar-Boston.html',
    );
  });

  it('returns null when no valid listing is present', () => {
    expect(resolveTripadvisorUrl({ name: 'Foo', tags: {} })).toBeNull();
    expect(
      resolveTripadvisorUrl({
        name: 'Foo',
        tags: { 'polaris:tripadvisor': 'https://example.com' },
      }),
    ).toBeNull();
  });
});

describe('discoverTripadvisorFromWebsiteHtml', () => {
  it('finds a tripadvisor sameAs link among other anchors', () => {
    const html = [
      '<a href="https://facebook.com/foo">Facebook</a>',
      '<a href="https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-NYC.html">Tripadvisor</a>',
      '<a href="https://example.com/gallery">Gallery</a>',
    ].join('\n');
    expect(discoverTripadvisorFromWebsiteHtml(html, 'https://foo.com/')).toBe(
      'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-NYC.html',
    );
  });

  it('ignores non-tripadvisor and disallowed-host links', () => {
    const html = [
      '<a href="https://www.yelp.com/restaurant/foo">Yelp</a>',
      '<a href="https://nottripadvisor.com/Restaurant-1">Fake</a>',
    ].join('\n');
    expect(discoverTripadvisorFromWebsiteHtml(html, 'https://foo.com/')).toBeNull();
  });
});

describe('parseExactCount', () => {
  it('parses exact counts with thousands separators', () => {
    expect(parseExactCount('1,234 reviews')).toBe(1234);
    expect(parseExactCount('987 reviews')).toBe(987);
    expect(parseExactCount('0 reviews')).toBe(0);
  });

  it('rejects approximate counts', () => {
    expect(parseExactCount('over 1,000 reviews')).toBeNull();
    expect(parseExactCount('about 50 reviews')).toBeNull();
    expect(parseExactCount('1.2K reviews')).toBeNull();
    expect(parseExactCount('more than 10,000 reviews')).toBeNull();
  });
});

describe('parseExternalRatingFromHtml', () => {
  it('extracts aggregateRating from JSON-LD', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Restaurant",
          "name": "The Prime Meathouse",
          "aggregateRating": {
            "@type": "aggregateRating",
            "ratingValue": "4.5",
            "reviewCount": "2345"
          }
        }
      </script>`;
    const rating = parseExternalRatingFromHtml(html);
    expect(rating).not.toBeNull();
    expect(rating?.rating).toBe(4.5);
    expect(rating?.reviewCount).toBe(2345);
    expect(rating?.listingName).toBe('The Prime Meathouse');
  });

  it('falls back to data-automation element text when no JSON-LD is present', () => {
    const html = `
      <div data-automation="review-summary">4.5 star rating</div>
      <div data-automation="review-count-summary">1,234 reviews</div>`;
    const rating = parseExternalRatingFromHtml(html);
    expect(rating?.rating).toBe(4.5);
    expect(rating?.reviewCount).toBe(1234);
  });

  it('returns null on anti-bot challenge pages', () => {
    const html = '<html><body><div id="datadome">Please verify you are human</div></body></html>';
    expect(parseExternalRatingFromHtml(html)).toBeNull();
  });

  it('returns null when rating or count is missing', () => {
    const html = '<div data-automation="review-summary">4.5 star rating</div>';
    expect(parseExternalRatingFromHtml(html)).toBeNull();
  });
});

describe('extractRatingFromWebViewMessage', () => {
  it('parses a structured rating payload', () => {
    const payload = JSON.stringify({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'The Prime Meathouse',
      ldAddress: '123 W 26th St, New York',
      automation: [],
      challenge: false,
    });
    const raw = extractRatingFromWebViewMessage(payload);
    expect(raw).not.toBeNull();
    expect(raw?.rating).toBe(4.5);
    expect(raw?.reviewCount).toBe(2345);
    expect(raw?.listingName).toBe('The Prime Meathouse');
  });

  it('ignores non-tripadvisor and malformed payloads', () => {
    expect(extractRatingFromWebViewMessage('not json')).toBeNull();
    expect(extractRatingFromWebViewMessage(JSON.stringify({ type: 'website-photos' }))).toBeNull();
  });
});

describe('validateExternalRating', () => {
  const base: RawExternalRating = {
    rating: 4.5,
    reviewCount: 1234,
    listingName: 'The Prime Meathouse',
    listingAddress: null,
    challenge: false,
  };

  it('accepts a valid, well-formed rating', () => {
    const s = validateExternalRating(
      base,
      'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review.html',
    );
    expect(s).not.toBeNull();
    expect(s?.provider).toBe('tripadvisor');
    expect(s?.rating).toBe(4.5);
    expect(s?.reviewCount).toBe(1234);
    expect(s?.observedAt).toBeGreaterThan(0);
  });

  it('rejects out-of-range ratings', () => {
    expect(
      validateExternalRating({ ...base, rating: 6 }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
    expect(
      validateExternalRating({ ...base, rating: -0.1 }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
    expect(
      validateExternalRating({ ...base, rating: NaN }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
  });

  it('rejects non-integer or negative counts', () => {
    expect(
      validateExternalRating({ ...base, reviewCount: 12.5 }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
    expect(
      validateExternalRating({ ...base, reviewCount: -1 }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
  });

  it('rejects challenge pages and missing listing names', () => {
    expect(
      validateExternalRating({ ...base, challenge: true }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
    expect(
      validateExternalRating({ ...base, listingName: '' }, 'https://www.tripadvisor.com/'),
    ).toBeNull();
  });

  it('rejects when the listing name does not match the expected POI', () => {
    expect(
      validateExternalRating(base, 'https://www.tripadvisor.com/', {
        expectedName: 'Totally Different Place',
      }),
    ).toBeNull();
  });

  it('carries the listing address when present', () => {
    const s = validateExternalRating(
      { ...base, listingAddress: '123 W 26th St' },
      'https://www.tripadvisor.com/',
    );
    expect(s?.listingAddress).toBe('123 W 26th St');
  });
});

describe('namesMatch', () => {
  it('matches exact, normalized names', () => {
    expect(namesMatch('The Prime Meathouse', 'the prime meathouse')).toBe(true);
    expect(namesMatch('Foo Bar!', 'Foo Bar')).toBe(true);
  });

  it('matches when one name contains the other (min 4 chars)', () => {
    expect(namesMatch('The Prime Meathouse & Bar', 'The Prime Meathouse')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(namesMatch('Foo Bar', 'Baz Qux')).toBe(false);
    expect(namesMatch('Foo', 'Bar')).toBe(false);
  });
});

describe('resolveRatingSource', () => {
  beforeEach(() => {
    clearTripadvisorRatingCache();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html></html>'),
    } as unknown as Response);
  });

  it('resolves from an explicit tag without network', async () => {
    const source = await resolveRatingSource({
      name: 'Foo',
      tags: {
        'polaris:tripadvisor':
          'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html',
      },
    });
    expect(source?.listingUrl).toBe(
      'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('discovers a listing from the POI website sameAs metadata', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          '<a href="https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html">TA</a>',
        ),
    }) as unknown as typeof fetch;
    const source = await resolveRatingSource({ name: 'Foo', website: 'foo.com' });
    expect(source?.listingUrl).toBe(
      'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo.html',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when nothing is resolvable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html></html>'),
    }) as unknown as typeof fetch;
    await expect(resolveRatingSource({ name: 'Foo', website: null })).resolves.toBeNull();
  });
});
