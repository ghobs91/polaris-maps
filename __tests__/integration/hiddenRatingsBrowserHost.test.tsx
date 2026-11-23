/**
 * The hidden ratings browser is the most expensive native object this app
 * creates: a WKWebView is a whole web-content process. These tests pin the
 * lifecycle rules that keep it from costing the UI anything it does not have to:
 *
 *  - one view per pass, never a fresh WKWebView per stage,
 *  - the view released shortly after the last stage ends, so an idle app holds
 *    no web-content process and no provider page keeps rendering,
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
    jest.useFakeTimers();
  });

  afterEach(() => {
    setHiddenBrowserSpec(null);
    jest.useRealTimers();
  });

  it('mounts nothing while no stage is live', () => {
    render(<HiddenRatingsBrowserHost />);
    expect(props()).toBeNull();
    expect((global as any).__hostMounts).toBe(0);
  });

  it('reuses one view across stage URIs instead of remounting', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('tripadvisor', 'https://www.tripadvisor.com/A')));
    expect(props()?.source).toEqual({ uri: 'https://www.tripadvisor.com/A' });

    act(() => setHiddenBrowserSpec(spec('tripadvisor', 'https://www.tripadvisor.com/B')));
    expect(props()?.source).toEqual({ uri: 'https://www.tripadvisor.com/B' });

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    expect(props()?.source).toEqual({ uri: 'https://www.yelp.com/biz/c' });

    // Four stages would previously have meant four WKWebView creations.
    expect((global as any).__hostMounts).toBe(1);
  });

  it('never navigates to a host-less URL (that aborts the app)', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    act(() => setHiddenBrowserSpec(null));

    // Still the last provider URL: releasing the page is done by unmounting, not
    // by navigating to `about:blank` — react-native-webview routes a host-less
    // source to `-[WKWebView loadFileURL:]`, which throws on the main thread.
    expect(props()?.source).toEqual({ uri: 'https://www.yelp.com/biz/c' });
  });

  it('releases the view shortly after the last stage ends', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));
    act(() => setHiddenBrowserSpec(null));
    expect(props()).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(1_500);
    });
    expect(props()).toBeNull();
  });

  it('keeps the view alive across a handoff gap and is not remounted for it', () => {
    render(<HiddenRatingsBrowserHost />);

    act(() => setHiddenBrowserSpec(spec('tripadvisor', 'https://www.tripadvisor.com/A')));
    act(() => setHiddenBrowserSpec(null));
    act(() => {
      jest.advanceTimersByTime(500);
    });
    act(() => setHiddenBrowserSpec(spec('yelp', 'https://www.yelp.com/biz/c')));

    expect(props()?.source).toEqual({ uri: 'https://www.yelp.com/biz/c' });
    expect((global as any).__hostMounts).toBe(1);
  });
});
