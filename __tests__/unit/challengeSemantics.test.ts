import {
  buildCollectorScript,
  hasChallengeMarkers,
  pageIsChallenge,
} from '../../src/services/poi/externalRatings/core';

describe('pageIsChallenge (calibrated semantics)', () => {
  it('markers alone are not a verdict when data was extracted', () => {
    const html =
      '<script src="https://geo.captcha-delivery.com/captcha/"></script><div>datadome</div>';
    expect(hasChallengeMarkers(html)).toBe(true);
    expect(pageIsChallenge(html, true)).toBe(false);
  });

  it('is a challenge when markers are present and nothing was extracted', () => {
    expect(pageIsChallenge('<div>datadome instance token</div>', false)).toBe(true);
  });

  it('a clean page is never a challenge', () => {
    expect(pageIsChallenge('<div>ordinary listing</div>', true)).toBe(false);
    expect(pageIsChallenge('<div>ordinary listing</div>', false)).toBe(false);
  });

  it('detects real interstitial pages', () => {
    expect(pageIsChallenge('<html><body>verify you are human</body></html>', false)).toBe(true);
  });
});

describe('buildCollectorScript (ES5, retriable)', () => {
  it('generates a retriable collector that posts once with data', () => {
    const js = buildCollectorScript({
      providerId: 'yelp',
      payloadType: 'external-rating',
      hasDataJs: 'out.value != null',
      collectBodyJs: '    out.value = document.body ? "x" : null;',
      initialDelayMs: 100,
      retryIntervalMs: 200,
      maxAttempts: 3,
    });
    // ES5-compatible surface: no optional chaining, no arrow functions.
    expect(js).not.toMatch(/=>/);
    expect(js).not.toMatch(/\bconst\b|\blet\b/);
    expect(js).toContain('ATTEMPTS = 3');
    expect(js).toContain('setTimeout(collect');
    expect(js).toContain('"external-rating"');
    expect(js).toContain('ReactNativeWebView.postMessage');
  });

  it('retries until data appears, then posts exactly once', () => {
    jest.resetModules();
    const post: string[] = [];
    const store: Record<string, unknown> = {};
    (store as { window?: unknown }).window = {
      ReactNativeWebView: {
        // Flaky first pass, data on the third collect.
        postMessage: (data: string) => {
          post.push(data);
          return undefined;
        },
      },
    };
    const sandbox = store as unknown as Record<string, unknown>;
    sandbox.document = { body: true, querySelector: () => null, querySelectorAll: () => [] };

    const script = buildCollectorScript({
      providerId: 'test',
      payloadType: 'external-rating',
      hasDataJs: 'out.value != null',
      collectBodyJs: `    sandbox.__calls = (sandbox.__calls || 0) + 1;
    out.value = sandbox.__calls >= 3 ? 42 : null;`,
      initialDelayMs: 0,
      retryIntervalMs: 1,
      maxAttempts: 5,
    });

    sandbox.__calls = 0;
    sandbox.setTimeout = (fn: () => void) => {
      queueMicrotask(fn);
      return 0;
    };
    const compiled = new Function('window', 'document', 'sandbox', 'setTimeout', script) as (
      w: unknown,
      d: unknown,
      s: unknown,
      t: unknown,
    ) => boolean;
    compiled(sandbox.window, sandbox, sandbox, sandbox.setTimeout);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(post.length).toBe(1);
        const payload = JSON.parse(post[0] as string) as { value: number };
        expect(payload.value).toBe(42);
        resolve();
      }, 20);
    });
  });
});
