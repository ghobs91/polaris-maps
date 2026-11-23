/**
 * The hidden ratings browser is the most expensive native object this app
 * creates: a WKWebView is a whole web-content process. These tests pin the
 * mounting policy that is known to *load* on a real device:
 *
 *  - a FRESH view per stage, keyed by provider+URI (a reused view navigated
 *    between stages sat silent on device until the stage clock killed it, so
 *    ratings never loaded),
 *  - nothing mounted while no stage is live,
 *  - never a host-less navigation (react-native-webview turns `about:blank` into
 *    `-[WKWebView loadFileURL:]`, which aborts the app).
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories may only reference `mock*`-prefixed bindings
const { useEffect: mockUseEffect } = require('react') as typeof import('react');

jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => {
    mockUseEffect(() => {
      (global as any).__hostMounts = ((global as any).__hostMounts ?? 0) + 1;
    }, []);
    mockUseEffect(() => {
      (global as any).__hostProps = props;
      return () => {
        (global as any).__hostProps = null;
      };
    });
    return null;
  },
}));

import {
  HiddenRatingsBrowserHost,
  setHiddenBrowserSpec,
  type HiddenBrowserSpec,
} from '../../src/components/map/HiddenRatingsBrowserHost';
import { providerById } from '../../src/services/poi/externalRatings';

function props(): Record<string, unknown> | null {
  return (global as any).__hostProps as Record<string, unknown> | null;
}

function spec(provider: 'tripadvisor' | 'yelp', uri: string): HiddenBrowserSpec {
  return { provider, uri, injectedJavaScript: `/* ${uri} */` };
}

describe('HiddenRatingsBrowserHost', () => {
  beforeEach(() => {
    (global as any).__hostProps = null;
    (global as any).__hostMounts = 0;
    setHiddenBrowserSpec(null);
  });

  afterEach(() => {
    setHiddenBrowserSpec(null);
  });

  it('mounts nothing while no stage is live', () => {
    render(<HiddenRatingsBrowserHost />);
    expect(props()).toBeNull();
    expect((global as any).__hostMounts).toBe(0);
  });

  it('mounts a fresh view for each stage', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('tripadvisor', 'https://www.tripadvisor.com/A')));
    expect(props()?.source).toEqual({ uri: 'https://www.tripadvisor.com/A' });

    act(() => setHiddenBrowserSpec(spec('tripadvisor', 'https://www.tripadvisor.com/B')));
    expect(props()?.source).toEqual({ uri: 'https://www.tripadvisor.com/B' });

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    expect(props()?.source).toEqual({ uri: 'https://www.yelp.com/biz/c' });

    // Three stages, three fresh WKWebViews. Reusing one was measurably broken on
    // device: every stage after the first never loaded.
    expect((global as any).__hostMounts).toBe(3);
  });

  it('unmounts the view as soon as no stage is live', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    expect(props()).not.toBeNull();

    act(() => setHiddenBrowserSpec(null));
    expect(props()).toBeNull();
  });

  it('does not copy the shared cookie jar into the browser on every navigation', () => {
    render(<HiddenRatingsBrowserHost />);
    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));

    // `sharedCookiesEnabled` makes react-native-webview enumerate every cookie
    // in NSHTTPCookieStorage on the main thread per navigation and hold
    // `loadRequest` until each write completes. Nothing in this app populates
    // that jar, so the flag is pure main-thread cost — and it grows with how
    // long the device has been used, which is why a fresh simulator never shows
    // the stall a real phone does.
    expect(props()?.sharedCookiesEnabled).toBe(false);
  });

  it('presents the user agent the provider declares', () => {
    render(<HiddenRatingsBrowserHost />);

    // The UA is per provider, because what each one serves depends on it: a
    // desktop UA is 403'd by TripAdvisor, and Yelp's mobile site is the only
    // variant its DataDome edge answers in this browser.
    for (const id of ['tripadvisor', 'yelp'] as const) {
      act(() => setHiddenBrowserSpec(spec(id, `https://example.test/${id}`)));
      expect(props()?.userAgent).toBe(providerById(id).userAgent);
    }
  });

  it('keeps the stage’s collector script on the mounted view', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    expect(props()?.injectedJavaScript).toBe('/* https://www.yelp.com/biz/c */');
  });
});
