import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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

const mockResolveRatingSource = jest.fn();

jest.mock('../../src/services/poi/tripadvisorService', () => {
  const actual = jest.requireActual('../../src/services/poi/tripadvisorService');
  return {
    ...actual,
    resolveRatingSource: (...args: unknown[]) => mockResolveRatingSource(...args),
    clearTripadvisorRatingCache: jest.fn(),
  };
});

import { TripadvisorRatingCard } from '../../src/components/map/TripadvisorRatingCard';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

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

const VALID_PAYLOAD = JSON.stringify({
  type: 'external-rating',
  provider: 'tripadvisor',
  ldRating: 4.5,
  ldCount: 2345,
  ldName: 'Foo Bar',
  ldAddress: null,
  automation: [],
  challenge: false,
});

describe('TripadvisorRatingCard', () => {
  beforeEach(() => {
    (global as any).__lastWebViewProps = null;
    mockResolveRatingSource.mockResolvedValue({
      listingUrl:
        'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-Bar-New_York_City.html',
      listingName: null,
    });
  });

  it('loads the listing in a hidden WebView and surfaces a validated rating', async () => {
    const screen = render(<TripadvisorRatingCard poi={makePoi('Foo Bar')} resetKey="place-1" />);

    // The hidden WebView is mounted with the tripadvisor listing + injected JS.
    await waitFor(() => expect((global as any).__lastWebViewProps).toBeTruthy());
    const webViewProps = (global as any).__lastWebViewProps as Record<string, unknown>;
    expect(webViewProps.source).toEqual({
      uri: 'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-Bar-New_York_City.html',
    });
    expect(typeof webViewProps.injectedJavaScript).toBe('string');

    // Simulate the on-device extraction posting back a valid rating.
    const onMessage = webViewProps.onMessage as (e: { nativeEvent: { data: string } }) => void;
    act(() => {
      onMessage({ nativeEvent: { data: VALID_PAYLOAD } });
    });

    await waitFor(() => expect(screen.getByTestId('tripadvisor-rating-section')).toBeTruthy());
    expect(screen.getByTestId('tripadvisor-rating').props.children).toBe('4.5');
    expect(screen.getByText('2,345 reviews')).toBeTruthy();
    expect(screen.getByText('View on Tripadvisor')).toBeTruthy();
  });

  it('links out to the listing when "View on Tripadvisor" is pressed', async () => {
    const screen = render(<TripadvisorRatingCard poi={makePoi('Foo Bar')} resetKey="place-1" />);
    await waitFor(() => expect((global as any).__lastWebViewProps).toBeTruthy());
    const webViewProps = (global as any).__lastWebViewProps as Record<string, unknown>;
    const onMessage = webViewProps.onMessage as (e: { nativeEvent: { data: string } }) => void;
    act(() => {
      onMessage({ nativeEvent: { data: VALID_PAYLOAD } });
    });
    await waitFor(() => expect(screen.getByTestId('tripadvisor-rating-section')).toBeTruthy());

    const openURLMock = jest.fn();
    jest
      .spyOn(jest.requireActual('react-native').Linking, 'openURL')
      .mockImplementation(openURLMock as unknown as typeof import('react-native').Linking.openURL);

    act(() => {
      fireEvent.press(screen.getByText('View on Tripadvisor'));
    });
    expect(openURLMock).toHaveBeenCalledWith(
      'https://www.tripadvisor.com/Restaurant_Review-g1-d123-Review-Foo-Bar-New_York_City.html',
    );
  });

  it('stays hidden when the extraction is an anti-bot challenge page', async () => {
    const screen = render(<TripadvisorRatingCard poi={makePoi('Foo Bar')} resetKey="place-1" />);
    await waitFor(() => expect((global as any).__lastWebViewProps).toBeTruthy());
    const webViewProps = (global as any).__lastWebViewProps as Record<string, unknown>;
    const onMessage = webViewProps.onMessage as (e: { nativeEvent: { data: string } }) => void;
    act(() => {
      onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'external-rating',
            provider: 'tripadvisor',
            ldRating: 4.5,
            ldCount: 2345,
            ldName: 'Foo Bar',
            ldAddress: null,
            automation: [],
            challenge: true,
          }),
        },
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('tripadvisor-rating-section')).toBeNull();
  });
});
