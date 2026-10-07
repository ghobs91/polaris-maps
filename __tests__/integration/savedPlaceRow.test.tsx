import React from 'react';
import { render } from '@testing-library/react-native';

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
    isDark: true,
    colors: {
      background: '#10101C',
      surface: '#252538',
      border: '#444444',
      text: '#FFFFFF',
      textSecondary: '#A0A0B8',
      primary: '#0A84FF',
      warning: '#FF9F0A',
      success: '#30D158',
      error: '#FF453A',
    },
  }),
}));

jest.mock('../../src/services/regions/connectivityService', () => ({
  getConnectivity: () => ({ isConnected: false, quality: 'none', type: null }),
}));

import { SavedPlaceRow } from '../../src/components/places/SavedPlaceRow';
import type { SavedPlace } from '../../src/models/placeList';

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'p1',
    name: 'Cross Street Cafe',
    lat: 40.75,
    lng: -73.99,
    addedAt: 1,
    ...overrides,
  };
}

describe('SavedPlaceRow', () => {
  it('renders an external rating with attribution', () => {
    const screen = render(
      <SavedPlaceRow
        place={place()}
        onPress={() => {}}
        reviewSummary={{
          rating: 4.5,
          count: 2345,
          source: 'external',
          providers: ['tripadvisor', 'yelp'],
        }}
      />,
    );

    expect(screen.getByText('4.5')).toBeTruthy();
    expect(screen.getByText('(2,345)')).toBeTruthy();
    expect(screen.getByText('Tripadvisor · Yelp')).toBeTruthy();
  });

  it('labels a community rating', () => {
    const screen = render(
      <SavedPlaceRow
        place={place()}
        onPress={() => {}}
        reviewSummary={{ rating: 4, count: 3, source: 'community', providers: [] }}
      />,
    );

    expect(screen.getByText('4.0')).toBeTruthy();
    expect(screen.getByText('(3)')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
  });

  it('renders no review line when there is no summary', () => {
    const screen = render(<SavedPlaceRow place={place()} onPress={() => {}} />);
    expect(screen.queryByText('Community')).toBeNull();
    expect(screen.queryByText('Tripadvisor')).toBeNull();
  });
});
