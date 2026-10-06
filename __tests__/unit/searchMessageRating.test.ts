import { parseSearchMessageFromWebView } from '../../src/services/poi/externalRatings/core';

describe('parseSearchMessageFromWebView (inline rating fields)', () => {
  it('carries a numeric rating and exact count on a candidate', () => {
    const candidates = parseSearchMessageFromWebView(
      JSON.stringify({
        type: 'rating-search',
        provider: 'yelp',
        candidates: [
          {
            url: 'https://www.yelp.com/biz/foo-bar',
            name: 'Foo Bar',
            address: '600 Guerrero St, San Francisco',
            geo: { lat: 37.761, lng: -122.424 },
            rating: 4.2,
            reviewCount: 9206,
          },
        ],
      }),
      'yelp',
    );
    expect(candidates?.[0]?.rating).toBe(4.2);
    expect(candidates?.[0]?.reviewCount).toBe(9206);
    expect(candidates?.[0]?.geo).toEqual({ lat: 37.761, lng: -122.424 });
  });

  it('drops non-numeric or non-integer rating fields', () => {
    const candidates = parseSearchMessageFromWebView(
      JSON.stringify({
        type: 'rating-search',
        provider: 'yelp',
        candidates: [{ url: 'https://www.yelp.com/biz/x', rating: '4.2', reviewCount: 3.5 }],
      }),
      'yelp',
    );
    expect(candidates?.[0]?.rating).toBeUndefined();
    expect(candidates?.[0]?.reviewCount).toBeUndefined();
  });

  it('keeps simple url+name candidates intact', () => {
    const candidates = parseSearchMessageFromWebView(
      JSON.stringify({
        type: 'rating-search',
        provider: 'tripadvisor',
        candidates: [
          { url: 'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review.html', name: 'Foo' },
        ],
      }),
      'tripadvisor',
    );
    expect(candidates?.[0]).toEqual({
      url: 'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review.html',
      name: 'Foo',
      address: null,
      geo: null,
    });
  });
});
