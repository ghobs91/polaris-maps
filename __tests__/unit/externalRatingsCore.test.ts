import {
  buildCollectorScript,
  clearExternalRatingCache,
  fetchDiscoveryHtml,
} from '../../src/services/poi/externalRatings/core';
import { isAllowedExternalRatingUrl } from '../../src/services/poi/externalRatings';

/** Run a generated collector against a minimal page/bridge shim. */
function runCollector(script: string, document: unknown): string[] {
  const posted: string[] = [];
  const window = { ReactNativeWebView: { postMessage: (s: string) => posted.push(s) } };
  const fn = new Function('window', 'document', 'setTimeout', script) as (
    w: unknown,
    d: unknown,
    s: (cb: () => void, ms?: number) => unknown,
  ) => void;
  fn(window, document, (cb: () => void, ms?: number) => setTimeout(cb, ms));
  return posted;
}

describe('buildCollectorScript', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('posts exactly one terminal state when attempts are exhausted', () => {
    const posted = runCollector(
      buildCollectorScript({
        providerId: 'yelp',
        payloadType: 'external-rating',
        hasDataJs: 'false',
        collectBodyJs: '    out.ldRating = null;',
        retryIntervalMs: 10,
        maxAttempts: 3,
      }),
      { body: { innerHTML: '' } },
    );

    jest.advanceTimersByTime(100);

    expect(posted).toHaveLength(1);
    const msg = JSON.parse(posted[0]!);
    expect(msg.type).toBe('external-rating');
    expect(msg.provider).toBe('yelp');
    expect(msg.challenge).toBe(false);
  });

  it('posts as soon as data is available, without further attempts', () => {
    const posted = runCollector(
      buildCollectorScript({
        providerId: 'yelp',
        payloadType: 'external-rating',
        hasDataJs: 'true',
        collectBodyJs: '    out.ldRating = 4.2;',
        retryIntervalMs: 10,
        maxAttempts: 5,
      }),
      { body: { innerHTML: '' } },
    );

    // FIRST_DELAY defaults to 0, so the first collect runs synchronously.
    expect(posted).toHaveLength(1);
    jest.advanceTimersByTime(100);
    expect(posted).toHaveLength(1);
  });

  it('flags a terminal challenge when markers are present and no data was found', () => {
    const posted = runCollector(
      buildCollectorScript({
        providerId: 'yelp',
        payloadType: 'external-rating',
        hasDataJs: 'false',
        collectBodyJs: '    out.ldRating = null;',
        retryIntervalMs: 10,
        maxAttempts: 2,
      }),
      { body: { innerHTML: '<div id="datadome">verify you are human</div>' } },
    );

    jest.advanceTimersByTime(100);

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0]!).challenge).toBe(true);
  });
});

describe('fetchDiscoveryHtml', () => {
  beforeEach(() => clearExternalRatingCache());

  function mockFetch(html: string) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve(html),
    });
    (global as { fetch: unknown }).fetch = fetchMock;
    return fetchMock;
  }

  it('single-flights concurrent fetches for the same URL', async () => {
    const fetchMock = mockFetch('<html></html>');

    const [a, b] = await Promise.all([
      fetchDiscoveryHtml('https://foo.com/'),
      fetchDiscoveryHtml('https://foo.com/'),
    ]);

    expect(a).toBe('<html></html>');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves a cached result and refetches after the cache is cleared', async () => {
    const fetchMock = mockFetch('<html>one</html>');

    await fetchDiscoveryHtml('https://foo.com/');
    await fetchDiscoveryHtml('https://foo.com/');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearExternalRatingCache();
    await fetchDiscoveryHtml('https://foo.com/');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('isAllowedExternalRatingUrl', () => {
  it('allows only http(s) on a registered provider host', () => {
    expect(isAllowedExternalRatingUrl('https://www.yelp.com/biz/foo')).toBe(true);
    expect(isAllowedExternalRatingUrl('https://www.tripadvisor.com/Restaurant_Review-x.html')).toBe(
      true,
    );
    expect(isAllowedExternalRatingUrl('https://tripadvisor.co.uk/x')).toBe(false);
    expect(isAllowedExternalRatingUrl('https://evil-yelp.com/biz/foo')).toBe(false);
    expect(isAllowedExternalRatingUrl('data:text/html,hi')).toBe(false);
    expect(isAllowedExternalRatingUrl('blob:https://www.yelp.com/x')).toBe(false);
    expect(isAllowedExternalRatingUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalRatingUrl('mailto:x@y.com')).toBe(false);
  });
});
