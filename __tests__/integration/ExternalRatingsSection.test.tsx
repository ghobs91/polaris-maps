import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => {
    // Expose the last-mounted WebView props so the test can simulate onMessage.
    (global as any).__lastWebViewProps = props;
    return null;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      backgroundDark: '#10101C',
      border: '#444444',
      surface: '#252538',
      text: '#FFFFFF',
      textSecondary: '#A0A0B8',
      primary: '#0A84FF',
      warning: '#FF9F0A',
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
import { browseScheduler } from '../../src/services/poi/externalRatings/antiBot';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

const TA_LISTING_URL =
  'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-Bar-New_York_City.html';

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

const ADDRESS = '123 Main St, New York';
const TA_SEARCH_URL = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(`Foo Bar ${ADDRESS}`)}`;
const YELP_SEARCH_URL = `https://www.yelp.com/search?${new URLSearchParams({ find_desc: 'Foo Bar', find_loc: ADDRESS }).toString()}`;

describe('ExternalRatingsSection', () => {
  beforeEach(() => {
    (global as any).__lastWebViewProps = null;
    mockResolveKnownListing.mockReset();
    mockFetchAndParseRating.mockReset();
    mockFetchAndParseRating.mockResolvedValue(null);
    browseScheduler.reset();
  });

  it('loads a known TripAdvisor listing in a hidden WebView and surfaces a validated rating', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = render(<ExternalRatingsSection poi={makePoi('Foo Bar')} />);

    await waitFor(() => expect(webViewProps()?.source).toEqual({ uri: TA_LISTING_URL }));
    expect(typeof webViewProps().injectedJavaScript).toBe('string');

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
      expect(screen.getByTestId('external-rating-section-tripadvisor')).toBeTruthy(),
    );
    expect(screen.getByTestId('external-rating-tripadvisor').props.children).toBe('4.5');
    expect(screen.getByText('2,345 reviews')).toBeTruthy();
    expect(screen.getByText('View on Tripadvisor')).toBeTruthy();
  });

  it('falls back to search for both providers and matches by identity', async () => {
    mockResolveKnownListing.mockResolvedValue(null);

    const screen = render(
      <ExternalRatingsSection
        poi={makePoi('Foo Bar', {
          'addr:housenumber': '123',
          'addr:street': 'Main St',
          'addr:city': 'New York',
        })}
      />,
    );

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
    await waitFor(() =>
      expect(screen.getByTestId('external-rating-section-tripadvisor')).toBeTruthy(),
    );

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

    await waitFor(() => expect(screen.getByTestId('external-rating-section-yelp')).toBeTruthy());
    expect(screen.getByTestId('external-rating-yelp').props.children).toBe('4.2');
    expect(screen.getByText('View on Yelp')).toBeTruthy();
  });

  it('stays hidden when the extraction is an anti-bot challenge page', async () => {
    mockResolveKnownListing.mockImplementation((provider: { id: string }) =>
      Promise.resolve(provider.id === 'tripadvisor' ? TA_LISTING_URL : null),
    );

    const screen = render(<ExternalRatingsSection poi={makePoi('Foo Bar')} />);
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
      challenge: true,
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('external-rating-section-tripadvisor')).toBeNull();
  });
});
