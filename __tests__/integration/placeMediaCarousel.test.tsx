import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const mockReact = jest.requireActual('react') as typeof React;
    return mockReact.createElement('Image', props);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      background: '#FFFFFF',
      surface: '#F2F2F7',
      border: '#CCCCCC',
      text: '#000000',
      textSecondary: '#666666',
      primary: '#0A84FF',
    },
  }),
}));

const mockGetConnectivity = jest.fn();
jest.mock('../../src/services/regions/connectivityService', () => ({
  getConnectivity: () => mockGetConnectivity(),
}));

const mockItems = [
  {
    url: 'https://commons.example/full-a.jpg',
    thumbnailUrl: 'https://commons.example/thumb-a.jpg',
    source: 'wikimedia' as const,
    license: 'CC-BY-4.0',
    licenseUrl: 'https://commons.example/file-a',
    attribution: 'Wikimedia Commons',
  },
  {
    url: 'https://panoramax.example/full-b.jpg',
    thumbnailUrl: 'https://panoramax.example/thumb-b.jpg',
    source: 'panoramax' as const,
    attribution: 'Panoramax (CC-BY-SA)',
  },
];

const mockDefaultSupplements = jest.fn();
jest.mock('../../src/services/poi/placeMediaProviders', () => ({
  defaultPlaceMediaSupplements: () => mockDefaultSupplements(),
}));

const mockGetPlaceDetail = jest.fn();
jest.mock('../../src/services/places/placeDetailCache', () => ({
  canonicalPlaceKey: () => 'geo:1,2',
  getPlaceDetail: (...args: unknown[]) => mockGetPlaceDetail(...args),
  putPlaceDetail: jest.fn().mockResolvedValue(true),
}));

const mockFetchWebsitePhotos = jest.fn();
jest.mock('../../src/services/poi/websitePhotosService', () => ({
  fetchWebsitePhotos: (...args: unknown[]) => mockFetchWebsitePhotos(...args),
  normalizeWebsiteUrl: (url: string | null | undefined) => url ?? null,
}));

import { PlaceMediaCarousel } from '../../src/components/poi/PlaceMediaCarousel';

function renderCarousel() {
  return render(
    <PlaceMediaCarousel
      lat={48.8584}
      lng={2.2945}
      name="Eiffel Tower"
      osmId="243"
      tags={{}}
      resetKey={1}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConnectivity.mockReturnValue({ isConnected: true, quality: 'good', type: 'wifi' });
  mockGetPlaceDetail.mockResolvedValue(null);
  mockFetchWebsitePhotos.mockResolvedValue([]);
  mockDefaultSupplements.mockReturnValue([
    { id: 'wikimedia', fetch: jest.fn().mockResolvedValue(mockItems) },
  ]);
});

describe('PlaceMediaCarousel', () => {
  it('renders open-source media with attribution and opens a license link', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const screen = renderCarousel();

    await waitFor(() => expect(screen.getByTestId('place-media-thumb-0')).toBeTruthy());
    expect(screen.getByText('Wikimedia Commons')).toBeTruthy();

    fireEvent.press(screen.getByTestId('place-media-thumb-0'));

    expect(screen.getByTestId('place-media-viewer')).toBeTruthy();
    expect(screen.getByTestId('place-media-viewer-counter')).toHaveTextContent('1 / 2');
    expect(screen.getByText('Wikimedia Commons · CC-BY-4.0')).toBeTruthy();

    fireEvent.press(screen.getByTestId('place-media-license-link'));
    expect(openURL).toHaveBeenCalledWith('https://commons.example/file-a');
    openURL.mockRestore();
  });

  it('serves cached media metadata when offline', async () => {
    mockGetConnectivity.mockReturnValue({ isConnected: false, quality: 'none', type: null });
    mockGetPlaceDetail.mockResolvedValue({ media: JSON.stringify(mockItems) });

    const screen = renderCarousel();

    await waitFor(() => expect(screen.getByTestId('place-media-thumb-0')).toBeTruthy());
    expect(screen.queryByTestId('place-media-empty')).toBeNull();
  });

  it('shows a deliberate empty state when offline with no cache', async () => {
    mockGetConnectivity.mockReturnValue({ isConnected: false, quality: 'none', type: null });
    mockGetPlaceDetail.mockResolvedValue(null);

    const screen = renderCarousel();

    await waitFor(() => expect(screen.getByTestId('place-media-empty')).toBeTruthy());
    expect(screen.getByText('Photos are unavailable offline')).toBeTruthy();
  });

  it('re-fetches open media when connectivity returns', async () => {
    const fetchSpy = jest.fn().mockResolvedValue(mockItems);
    mockDefaultSupplements.mockReturnValue([{ id: 'wikimedia', fetch: fetchSpy }]);

    const screen = render(
      <PlaceMediaCarousel
        lat={48.8584}
        lng={2.2945}
        name="Eiffel Tower"
        osmId="243"
        tags={{}}
        resetKey={1}
        online={false}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('place-media-empty')).toBeTruthy());

    screen.rerender(
      <PlaceMediaCarousel
        lat={48.8584}
        lng={2.2945}
        name="Eiffel Tower"
        osmId="243"
        tags={{}}
        resetKey={1}
        online
      />,
    );

    await waitFor(() => expect(screen.getByTestId('place-media-thumb-0')).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('renders nothing online when no open media is found', async () => {
    mockDefaultSupplements.mockReturnValueOnce([
      { id: 'wikimedia', fetch: jest.fn().mockResolvedValue([]) },
    ]);

    const screen = renderCarousel();

    await waitFor(() => expect(screen.queryByTestId('place-media-section')).toBeNull());
    expect(screen.queryByTestId('place-media-empty')).toBeNull();
  });

  it('merges website photos with open-licensed media into one carousel', async () => {
    mockFetchWebsitePhotos.mockResolvedValue([
      'https://example.com/site/one.jpg',
      'https://example.com/site/two.jpg',
    ]);

    const screen = render(
      <PlaceMediaCarousel
        lat={48.8584}
        lng={2.2945}
        name="Eiffel Tower"
        osmId="243"
        websiteUrl="https://example.com"
        tags={{}}
        resetKey={2}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('place-media-thumb-0')).toBeTruthy());

    // 2 website photos + 2 open-licensed items, all in a single strip.
    expect(screen.getAllByTestId(/^place-media-thumb-\d+$/)).toHaveLength(4);
    expect(screen.getAllByText('From the web · example.com')).toHaveLength(2);
    expect(screen.getByText('Wikimedia Commons')).toBeTruthy();
  });
});
