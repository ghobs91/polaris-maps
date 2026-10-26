jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '0'.repeat(32)) }));
jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const mockReact = jest.requireActual('react') as typeof React;
    return mockReact.createElement('Image', props);
  },
}));

const mockGetCachedPlaceThumbnail = jest.fn();
const mockResolvePlaceThumbnail = jest.fn();
jest.mock('../../src/services/places/placeThumbnailService', () => ({
  getCachedPlaceThumbnail: (...args: unknown[]) => mockGetCachedPlaceThumbnail(...args),
  resolvePlaceThumbnail: (...args: unknown[]) => mockResolvePlaceThumbnail(...args),
  placeThumbnailSource: () => ({ key: 'wd:Q1', source: 'wikidata', value: 'Q1' }),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SearchResultRow } from '../../src/components/search/SearchResultRow';
import type { UnifiedSearchResult } from '../../src/services/search/unifiedSearch';

const full: UnifiedSearchResult = {
  name: 'Cafe A',
  subtitle: 'Main St',
  lat: 0,
  lng: 0,
  type: 'poi',
  osmType: 'amenity',
  osmSubtype: 'cafe',
  score: 80,
  distanceKm: 1.2,
  rating: 4.5,
  openNow: true,
  priceLevel: 2,
  city: 'Springfield',
};

const sparse: UnifiedSearchResult = {
  name: 'Somewhere',
  subtitle: '',
  lat: 1,
  lng: 1,
  type: 'place',
  score: 10,
  distanceKm: 0.3,
};

describe('SearchResultRow', () => {
  it('renders rich fields when present', () => {
    const { getByText } = render(<SearchResultRow result={full} onPress={() => {}} />);
    expect(getByText('Cafe A')).toBeTruthy();
    expect(getByText('4.5')).toBeTruthy();
    expect(getByText('Open')).toBeTruthy();
    expect(getByText('$$')).toBeTruthy();
    expect(getByText('0.7 mi')).toBeTruthy();
  });

  it('omits missing fields gracefully', () => {
    const { getByText, queryByText } = render(
      <SearchResultRow result={sparse} onPress={() => {}} />,
    );
    expect(getByText('Somewhere')).toBeTruthy();
    expect(queryByText('Open')).toBeNull();
    expect(queryByText('Closed')).toBeNull();
  });

  it('shows a closed badge for closed places', () => {
    const { getByText } = render(
      <SearchResultRow result={{ ...full, openNow: false }} onPress={() => {}} />,
    );
    expect(getByText('Closed')).toBeTruthy();
  });

  it('falls back to the subtitle and omits an unknown distance', () => {
    const { getByText, queryByText } = render(
      <SearchResultRow
        result={{ ...sparse, distanceKm: 0, subtitle: 'Main St, Springfield' }}
        onPress={() => {}}
      />,
    );
    expect(getByText('Main St, Springfield')).toBeTruthy();
    expect(queryByText('0.2 mi')).toBeNull();
  });

  it('invokes onPress with the result', () => {
    const onPress = jest.fn();
    const { getByText } = render(<SearchResultRow result={full} onPress={onPress} />);
    fireEvent.press(getByText('Cafe A'));
    expect(onPress).toHaveBeenCalledWith(full);
  });

  describe('thumbnails', () => {
    const withPlace: UnifiedSearchResult = {
      ...full,
      poi: {
        id: 42,
        lat: 0,
        lng: 0,
        name: 'Cafe A',
        type: 'amenity',
        subtype: 'cafe',
        tags: { amenity: 'cafe', wikidata: 'Q1' },
      },
    };

    beforeEach(() => {
      mockGetCachedPlaceThumbnail.mockReset().mockReturnValue(null);
      mockResolvePlaceThumbnail.mockReset().mockResolvedValue(null);
    });

    it('paints a cached thumbnail on the first render', () => {
      mockGetCachedPlaceThumbnail.mockReturnValue('https://cdn.example/cafe.jpg');

      const { getByTestId } = render(<SearchResultRow result={withPlace} onPress={() => {}} />);

      expect(getByTestId('search-result-thumbnail')).toBeTruthy();
      expect(mockResolvePlaceThumbnail).not.toHaveBeenCalled();
    });

    it('does not resolve a photo during render (lazy)', async () => {
      render(<SearchResultRow result={withPlace} onPress={() => {}} />);

      // Nothing is fetched synchronously — the row must paint first.
      expect(mockResolvePlaceThumbnail).not.toHaveBeenCalled();

      mockResolvePlaceThumbnail.mockResolvedValue('https://cdn.example/cafe.jpg');
      await waitFor(() =>
        expect(mockResolvePlaceThumbnail).toHaveBeenCalledWith(withPlace.poi?.tags),
      );
    });

    it('requests nothing for a result without place tags', async () => {
      render(<SearchResultRow result={sparse} onPress={() => {}} />);

      await waitFor(() => expect(mockGetCachedPlaceThumbnail).not.toHaveBeenCalled());
      expect(mockResolvePlaceThumbnail).not.toHaveBeenCalled();
    });
  });
});
