import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories may only reference `mock*`-prefixed bindings
const { useEffect: mockUseEffect } = require('react') as typeof import('react');

jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => {
    // Expose the last-mounted WebView props so the test can simulate onMessage,
    // and clear them on unmount so "no hidden browser mounted" is assertable.
    mockUseEffect(() => {
      (global as any).__lastWebViewProps = props;
      return () => {
        (global as any).__lastWebViewProps = null;
      };
    });
    return null;
  },
}));

const mockOpenBrowserAsync = jest.fn();

jest.mock('expo-web-browser', () => ({
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: true,
    colors: {
      backgroundDark: '#10101C',
      border: '#444444',
      surface: '#252538',
      text: '#FFFFFF',
      textSecondary: '#A0A0B8',
      primary: '#0A84FF',
      warning: '#FF9F0A',
      glass: { background: 'rgba(20,20,24,0.6)' },
    },
  }),
}));

const mockResolveKnownListing = jest.fn();
const mockFetchAndParseRating = jest.fn();

jest.mock('../../src/services/poi/externalRatings', () => {
  const actual = jest.requireActual('../../src/services/poi/externalRatings');
  return {
    ...actual,
    resolveKnownListing: (...args: unknown[]) => mockResolveKnownListing(...args),
    fetchAndParseRating: (...args: unknown[]) => mockFetchAndParseRating(...args),
  };
});

import { ExternalRatingsSection } from '../../src/components/map/ExternalRatingsSection';
import { HiddenRatingsBrowserHost } from '../../src/components/map/HiddenRatingsBrowserHost';

/**
 * The hidden browser is hosted OUTSIDE the sheet's subtree, so the tests mount
 * the host beside the section — the module-level spec bus connects them.
 */
function renderSection(props: Parameters<typeof ExternalRatingsSection>[0]) {
  return render(
    <>
      <ExternalRatingsSection {...props} />
      <HiddenRatingsBrowserHost />
    </>,
  );
}

function rerenderSection(
  screen: ReturnType<typeof renderSection>,
  props: Parameters<typeof ExternalRatingsSection>[0],
) {
  screen.rerender(
    <>
      <ExternalRatingsSection {...props} />
      <HiddenRatingsBrowserHost />
    </>,
  );
}
import { GEOLOCATION_GUARD_JS } from '../../src/constants/webViewScripts';
import { EXTERNAL_RATINGS_USER_AGENT } from '../../src/services/poi/externalRatings';
import { browseScheduler } from '../../src/services/poi/externalRatings/antiBot';
import { clearListingCache } from '../../src/services/poi/externalRatings/listingCache';
import { clearSessionPlaceRatings } from '../../src/services/places/placeRatingSessionCache';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

const TA_LISTING_URL =
  'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-Bar-New_York_City.html';
const YELP_LISTING_URL = 'https://www.yelp.com/biz/foo-bar';

function makePoi(name: string, tags: Record<string, string> = {}): OsmPoi {
  return {
    id: 1,
    lat: 40.75,
    lng: -73.99,
    name,
    type: 'amenity',
    subtype: 'restaurant',
    tags,
  };
}

function webViewProps(): Record<string, unknown> {
  return (global as any).__lastWebViewProps as Record<string, unknown>;
}

function onMessage(data: unknown): void {
  const handler = webViewProps().onMessage as (e: { nativeEvent: { data: string } }) => void;
  act(() => {
    handler({ nativeEvent: { data: JSON.stringify(data) } });
  });
}

/** The hidden browser runs in its own modal window; no stage, no window. */
function expectNoMountedBrowser(): void {
  expect((global as any).__lastWebViewProps).toBeNull();
}

const ADDRESS = '123 Main St, New York';
const TA_SEARCH_URL = `https://www.tripadvisor.com/Search?q=${encodeURIComponent('Foo Bar')}`;
const YELP_SEARCH_URL = `https://www.yelp.com/search?${new URLSearchParams({ find_desc: 'Foo Bar', find_loc: ADDRESS }).toString()}`;

describe('ExternalRatingsSection', () => {
  beforeEach(() => {
    (global as any).__lastWebViewProps = null;
    mockResolveKnownListing.mockReset();
    mockFetchAndParseRating.mockReset();
    browseScheduler.reset();
    // The section tests exercise rendering, not wall-clock pacing; the
    // scheduler's unit tests cover intervals, tokens and blocks.
    jest.spyOn(browseScheduler, 'acquirePageLoad').mockResolvedValue({ ok: true });
    jest.spyOn(browseScheduler, 'schedule').mockImplementation((_host, task) => task());
    clearSessionPlaceRatings();
    clearListingCache();
  });

  it('loads a known TripAdvisor listing in a hidden WebView and surfaces a validated rating', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = renderSection({ poi: makePoi('Foo Bar') });

    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    expect(webViewProps().userAgent).toBe(EXTERNAL_RATINGS_USER_AGENT);
    expect(typeof webViewProps().injectedJavaScript).toBe('string');
    expect(mockFetchAndParseRating).not.toHaveBeenCalled();

    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });

    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());
    expect(screen.getByTestId('external-ratings-combined-rating').props.children).toBe('4.5');
    expect(screen.getByText('2,345 reviews')).toBeTruthy();
    expect(screen.getByTestId('external-ratings-pill-tripadvisor')).toBeTruthy();
    expect(screen.queryByTestId('external-ratings-pill-yelp')).toBeNull();
  });

  it('passes the enriched website into the provider query when OSM carries none', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    renderSection({ poi: makePoi('Foo Bar'), website: 'https://foo.example.com' });

    await waitFor(() => expect(mockResolveKnownListing).toHaveBeenCalled());
    expect(mockResolveKnownListing.mock.calls[0][1]).toMatchObject({
      website: 'https://foo.example.com',
    });
  });

  it('falls back to search for both providers and matches by identity', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    const screen = renderSection({
      poi: makePoi('Foo Bar', {
        'addr:housenumber': '123',
        'addr:street': 'Main St',
        'addr:city': 'New York',
      }),
    });

    // TripAdvisor search runs first.
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_SEARCH_URL }));
    onMessage({
      type: 'rating-search',
      provider: 'tripadvisor',
      candidates: [
        {
          url: TA_LISTING_URL,
          name: 'Foo Bar',
          address: '123 Main St, New York',
          geo: { lat: 40.75, lng: -73.99 },
        },
      ],
    });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: '123 Main St, New York',
      geo: { lat: 40.75, lng: -73.99 },
      automation: [],
      challenge: false,
    });
    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());

    // Yelp search becomes the active WebView next.
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: YELP_SEARCH_URL }));
    onMessage({
      type: 'rating-search',
      provider: 'yelp',
      candidates: [
        {
          url: 'https://www.yelp.com/biz/foo-bar',
          name: 'Foo Bar',
          address: '123 Main St, New York',
          geo: { lat: 40.75, lng: -73.99 },
        },
      ],
    });
    await waitFor(() =>
      expect(webViewProps()?.source).toEqual({ uri: 'https://www.yelp.com/biz/foo-bar' }),
    );

    onMessage({
      type: 'external-rating',
      provider: 'yelp',
      ldRating: 4.2,
      ldCount: 321,
      ldName: 'Foo Bar',
      ldAddress: '123 Main St, New York',
      geo: { lat: 40.75, lng: -73.99 },
      automation: [],
      challenge: false,
    });

    await waitFor(() => expect(screen.getByTestId('external-ratings-pill-yelp')).toBeTruthy());
    // Combined: (4.5*2345 + 4.2*321) / (2345 + 321) = 4.46 -> "4.5"
    expect(screen.getByTestId('external-ratings-combined-rating').props.children).toBe('4.5');
    expect(screen.getByText('2,666 reviews')).toBeTruthy();
    expect(screen.getByTestId('external-ratings-pill-tripadvisor')).toBeTruthy();
  });

  it('resolves from the search card itself when it carries rating + identity', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    const screen = renderSection({
      poi: makePoi('Foo Bar', {
        'addr:housenumber': '123',
        'addr:street': 'Main St',
        'addr:city': 'New York',
      }),
    });

    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_SEARCH_URL }));
    onMessage({
      type: 'rating-search',
      provider: 'tripadvisor',
      candidates: [
        {
          url: TA_LISTING_URL,
          name: 'Foo Bar',
          address: '123 Main St, New York',
          geo: { lat: 40.75, lng: -73.99 },
          rating: 4.5,
          reviewCount: 2345,
        },
      ],
    });

    // No listing navigation: the card answered.
    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());
    expect(screen.getByTestId('external-ratings-combined-rating').props.children).toBe('4.5');
    expect(screen.getByText('2,345 reviews')).toBeTruthy();
    expect(screen.getByTestId('external-ratings-pill-tripadvisor')).toBeTruthy();
  });

  it('opens the provider listing when its pill is pressed', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });
    await waitFor(() =>
      expect(screen.getByTestId('external-ratings-pill-tripadvisor')).toBeTruthy(),
    );

    mockOpenBrowserAsync.mockReset();
    mockOpenBrowserAsync.mockResolvedValue({ type: 'dismiss' });

    act(() => {
      fireEvent.press(screen.getByTestId('external-ratings-pill-tripadvisor'));
    });
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(TA_LISTING_URL, expect.anything());
  });

  it('shows a loading row while ratings resolve', async () => {
    // Never resolves: the row stays in the loading state.
    mockResolveKnownListing.mockImplementation(() => new Promise(() => {}));

    const screen = renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(screen.getByTestId('external-ratings-loading')).toBeTruthy());
    expect(screen.queryByTestId('external-ratings-combined')).toBeNull();
    expect(screen.queryByTestId('external-ratings-empty')).toBeNull();
  });

  it('offers "write the first review" only when a provider answered no rating', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );
    const onWriteReview = jest.fn();

    const screen = renderSection({ poi: makePoi('Foo Bar'), onWriteReview });

    // Settle both providers: TripAdvisor's listing page rendered but carries
    // no rating data (a real "no rating" answer); Yelp's search stage fails
    // transiently (nothing learned about the place).
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });
    await waitFor(() => expect(webViewProps()?.source).toBeTruthy());
    const yelpError = webViewProps().onError as () => void;
    act(() => yelpError());

    await waitFor(() => {
      expect(screen.getByTestId('external-ratings-empty')).toBeTruthy();
    });
    expect(screen.getByText('No ratings yet — write the first review')).toBeTruthy();

    act(() => {
      fireEvent.press(screen.getByTestId('external-ratings-write-review'));
    });
    expect(onWriteReview).toHaveBeenCalledTimes(1);
  });

  it('shows an unavailable row — not "no ratings yet" — when the pass dies on transient failures', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    const screen = renderSection({ poi: makePoi('Foo Bar') });

    // Settle both providers with WebView errors: nothing was learned about the
    // place, so the section must not claim "no ratings yet".
    await waitFor(() => expect(webViewProps()?.source).toBeTruthy());
    const firstError = webViewProps().onError as () => void;
    act(() => firstError());
    await waitFor(() => expect(webViewProps()?.source).toBeTruthy());
    const secondError = webViewProps().onError as () => void;
    act(() => secondError());

    await waitFor(() => {
      expect(screen.getByTestId('external-ratings-unavailable')).toBeTruthy();
    });
    expect(screen.queryByTestId('external-ratings-empty')).toBeNull();
  });

  it('neutralizes web geolocation before the provider page loads', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    expect(webViewProps().injectedJavaScriptBeforeContentLoaded).toBe(GEOLOCATION_GUARD_JS);
    expect(webViewProps().injectedJavaScriptBeforeContentLoadedForMainFrameOnly).toBe(false);
  });

  it('rejects navigations that leave the provider host allowlist', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    const shouldStart = webViewProps().onShouldStartLoadWithRequest as (r: {
      url: string;
    }) => boolean;
    expect(shouldStart({ url: TA_LISTING_URL })).toBe(true);
    expect(shouldStart({ url: 'about:blank' })).toBe(true);
    expect(shouldStart({ url: 'https://evil.example.com/ad' })).toBe(false);
    expect(shouldStart({ url: 'data:text/html,hi' })).toBe(false);
  });

  it('gives the hidden browser a real viewport instead of a zero-size frame', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    const style = webViewProps().style as { width?: number; height?: number };
    expect(style.width).toBeGreaterThan(0);
    expect(style.height).toBeGreaterThan(0);
  });

  it('unloads the provider page once the pass settles', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : YELP_LISTING_URL),
    );

    const screen = renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });

    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: YELP_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'yelp',
      ldRating: 4.2,
      ldCount: 321,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });
    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());

    // After the pass settles the hidden browser is torn down entirely: each
    // stage mounts a fresh WKWebView (cookies persist in the shared
    // website-data store), so no provider page keeps rendering behind the card.
    await waitFor(expectNoMountedBrowser);
  });

  it('unloads the provider page while the gate is closed for a closing card', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const poi = makePoi('Foo Bar');
    const screen = renderSection({ poi });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    // Closing the card tears the modal window (and the hidden browser with it)
    // down entirely — cookies persist in the shared website-data store.
    rerenderSection(screen, { poi, enabled: false });
    await waitFor(expectNoMountedBrowser);
  });

  it('keeps a resolved rating on screen while a closing card stays mounted', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const poi = makePoi('Foo Bar');
    const screen = renderSection({ poi });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });
    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());

    rerenderSection(screen, { poi, enabled: false });
    expect(screen.getByTestId('external-ratings-combined')).toBeTruthy();
    expect(screen.queryByTestId('external-ratings-loading')).toBeNull();
  });

  it('never flashes a previous place rating while a new card is opening', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: 4.5,
      ldCount: 2345,
      ldName: 'Foo Bar',
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
    });
    await waitFor(() => expect(screen.getByTestId('external-ratings-combined')).toBeTruthy());

    mockResolveKnownListing.mockReset();
    mockResolveKnownListing.mockImplementation(() => new Promise(() => {}));
    rerenderSection(screen, { poi: { ...makePoi('Bar Baz'), id: 2 }, enabled: false });

    expect(screen.queryByTestId('external-ratings-combined')).toBeNull();
    expect(screen.getByTestId('external-ratings-loading')).toBeTruthy();
  });

  it('mounts no hidden browser at all while a card is still opening', () => {
    renderSection({ poi: makePoi('Foo Bar'), enabled: false });
    expect((global as any).__lastWebViewProps).toBeNull();
  });

  it('shows an honest blocked state after a hard block page', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'yelp' ? YELP_LISTING_URL : null),
    );

    const screen = renderSection({
      poi: makePoi('Foo Bar', {
        'addr:housenumber': '123',
        'addr:street': 'Main St',
        'addr:city': 'New York',
      }),
    });

    // TripAdvisor holds the single hidden-WebView slot first.
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_SEARCH_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: true,
    });

    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: YELP_LISTING_URL }));
    onMessage({
      type: 'external-rating',
      provider: 'yelp',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: false,
      blocked: true,
    });

    await waitFor(() => expect(screen.getByTestId('external-ratings-blocked')).toBeTruthy());
    expect(screen.getByText(/Yelp is temporarily blocking review lookups/)).toBeTruthy();
  });

  it('stays hidden when the extraction is an anti-bot challenge page', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = renderSection({ poi: makePoi('Foo Bar') });
    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));

    onMessage({
      type: 'external-rating',
      provider: 'tripadvisor',
      ldRating: null,
      ldCount: null,
      ldName: null,
      ldAddress: null,
      geo: null,
      automation: [],
      challenge: true,
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('external-ratings-combined')).toBeNull();
  });
});
