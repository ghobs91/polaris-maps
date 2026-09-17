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

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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

  it('invokes onPress with the result', () => {
    const onPress = jest.fn();
    const { getByText } = render(<SearchResultRow result={full} onPress={onPress} />);
    fireEvent.press(getByText('Cafe A'));
    expect(onPress).toHaveBeenCalledWith(full);
  });
});
