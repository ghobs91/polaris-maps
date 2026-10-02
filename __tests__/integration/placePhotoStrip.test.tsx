import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const mockReact = jest.requireActual('react') as typeof React;
    return mockReact.createElement('Image', props);
  },
}));

jest.mock('react-native-mmkv', () => {
  const store = new Map<string, string>();
  return {
    MMKV: class {
      getString = (key: string) => store.get(key);
      set = (key: string, value: string) => store.set(key, value);
      delete = (key: string) => store.delete(key);
    },
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '0'.repeat(32)) }));

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

const mockFetchWebsitePhotos = jest.fn();
jest.mock('../../src/services/poi/websitePhotosService', () => ({
  fetchWebsitePhotos: (...args: unknown[]) => mockFetchWebsitePhotos(...args),
  normalizeWebsiteUrl: (url: string | null | undefined) => url ?? null,
}));

import { PlacePhotoStrip } from '../../src/components/places/PlacePhotoStrip';
import {
  clearPlacePhotoCache,
  setCachedPlacePhotos,
} from '../../src/services/places/placePhotoCache';

const PAGE = 'https://cafe.example/';

describe('PlacePhotoStrip', () => {
  beforeEach(() => {
    clearPlacePhotoCache();
    jest.clearAllMocks();
    mockGetConnectivity.mockReturnValue({ isConnected: true, quality: 'good', type: 'wifi' });
    mockFetchWebsitePhotos.mockResolvedValue([]);
  });

  it('renders cached photos without re-scraping the site', async () => {
    setCachedPlacePhotos(PAGE, ['https://cafe.example/a.jpg']);

    const screen = render(<PlacePhotoStrip websiteUrl={PAGE} resetKey="p1" />);

    await waitFor(() => expect(screen.getByTestId('place-photo-strip')).toBeTruthy());
    expect(mockFetchWebsitePhotos).not.toHaveBeenCalled();
  });

  it('fetches and caches photos on a cold cache', async () => {
    mockFetchWebsitePhotos.mockResolvedValue(['https://cafe.example/a.jpg']);

    const screen = render(<PlacePhotoStrip websiteUrl={PAGE} resetKey="p1" />);

    await waitFor(() => expect(screen.getByTestId('place-photo-strip')).toBeTruthy());
    expect(mockFetchWebsitePhotos).toHaveBeenCalledWith(PAGE);
  });

  it('renders nothing when offline with no cache', async () => {
    mockGetConnectivity.mockReturnValue({ isConnected: false, quality: 'none', type: null });

    const screen = render(<PlacePhotoStrip websiteUrl={PAGE} resetKey="p1" />);

    await waitFor(() => expect(screen.queryByTestId('place-photo-strip')).toBeNull());
    expect(mockFetchWebsitePhotos).not.toHaveBeenCalled();
  });

  it('renders nothing without a website', () => {
    const screen = render(<PlacePhotoStrip websiteUrl={null} resetKey="p1" />);
    expect(screen.queryByTestId('place-photo-strip')).toBeNull();
  });
});
