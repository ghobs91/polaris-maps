import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const mockReact = jest.requireActual('react') as typeof React;
    return mockReact.createElement('Image', props);
  },
}));

jest.mock('react-native-webview', () => ({
  WebView: () => null,
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
    },
  }),
}));

jest.mock('../../src/services/poi/websitePhotosService', () => {
  const actual = jest.requireActual('../../src/services/poi/websitePhotosService');
  return { ...actual, fetchWebsitePhotos: jest.fn() };
});

import { WebsitePhotosCarousel } from '../../src/components/map/WebsitePhotosCarousel';
import { fetchWebsitePhotos } from '../../src/services/poi/websitePhotosService';

const fetchWebsitePhotosMock = fetchWebsitePhotos as jest.MockedFunction<typeof fetchWebsitePhotos>;

describe('WebsitePhotosCarousel', () => {
  beforeEach(() => {
    fetchWebsitePhotosMock.mockResolvedValue([
      'https://example.com/gallery/one.jpg',
      'https://example.com/gallery/two.jpg',
    ]);
  });

  it('opens the tapped image in a swipeable expanded viewer', async () => {
    const screen = render(
      <WebsitePhotosCarousel websiteUrl="https://example.com" resetKey="place-1" />,
    );

    await waitFor(() => expect(screen.getByTestId('website-photo-thumbnail-0')).toBeTruthy());

    act(() => {
      fireEvent.press(screen.getByTestId('website-photo-thumbnail-1'));
    });

    expect(screen.getByTestId('website-photo-viewer')).toBeTruthy();
    expect(screen.getByText('2 / 2')).toBeTruthy();
    const closeButton = screen.getByLabelText('Close photo viewer');
    expect(closeButton).toBeTruthy();
    expect(closeButton.props.hitSlop).toBe(8);
    expect(screen.getByTestId('website-photo-viewer-header').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingTop: 52 })]),
    );
  });
});
