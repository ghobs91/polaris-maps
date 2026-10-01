import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: true,
    colors: {
      background: '#000000',
      surface: '#1C1C1E',
      border: '#333333',
      text: '#FFFFFF',
      textSecondary: '#AAAAAA',
      primary: '#0A84FF',
      white: '#FFFFFF',
    },
  }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ lat: '48.8584', lng: '2.2945', name: 'Eiffel Tower' }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('../../src/components/imagery/PanoramaViewer', () => {
  const ReactLocal = jest.requireActual('react') as typeof React;
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    PanoramaViewer: (props: { imageUrl: string; initialYaw?: number; testID?: string }) =>
      ReactLocal.createElement(View, {
        testID: props.testID ?? 'panorama',
        accessibilityLabel: `img:${props.imageUrl} yaw:${props.initialYaw}`,
      }),
  };
});

const mockFind = jest.fn();
jest.mock('../../src/services/imagery/streetViewService', () => {
  const actual = jest.requireActual('../../src/services/imagery/streetViewService');
  return {
    ...actual,
    findStreetViewPanoramas: (...args: unknown[]) => mockFind(...args),
    isMapillaryConfigured: () => true,
  };
});

import StreetViewScreen from '../../app/imagery/street-view';

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// Deliberately not in recency order — the screen must sort newest-first.
const captures = [
  {
    id: 'mapillary:newest',
    source: 'mapillary',
    lat: 48.8584,
    lng: 2.2945,
    capturedAt: secs('2025-01-15T00:00:00Z'),
    bearing: 90,
    isPano: true,
    imageUrl: 'https://mly.test/newest.jpg',
    attribution: 'Mapillary (CC-BY-SA)',
    contributor: 'bob',
  },
  {
    id: 'panoramax:oldest',
    source: 'panoramax',
    lat: 48.8584,
    lng: 2.2945,
    capturedAt: secs('2023-05-01T00:00:00Z'),
    isPano: true,
    imageUrl: 'https://pano.test/oldest.jpg',
    attribution: 'Panoramax (CC-BY-SA)',
  },
  {
    id: 'panoramax:middle',
    source: 'panoramax',
    lat: 48.8584,
    lng: 2.2945,
    capturedAt: secs('2024-09-05T00:00:00Z'),
    isPano: true,
    imageUrl: 'https://pano.test/middle.jpg',
    attribution: 'Panoramax (CC-BY-SA)',
  },
];

function viewerLabel(screen: ReturnType<typeof render>): string {
  return screen.getByTestId('street-view-panorama').props.accessibilityLabel ?? '';
}

describe('StreetViewScreen capture timeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFind.mockResolvedValue(captures);
  });

  it('opens on the most recent capture and steps back through a timeline dropdown', async () => {
    const screen = render(<StreetViewScreen />);

    await waitFor(() => expect(screen.getByTestId('street-view-panorama')).toBeTruthy());
    expect(mockFind).toHaveBeenCalledWith(48.8584, 2.2945, { includeMapillary: true });

    // Newest capture leads, regardless of source or lookup order.
    expect(viewerLabel(screen)).toContain('https://mly.test/newest.jpg');
    expect(viewerLabel(screen)).toContain('yaw:90');
    expect(screen.getByTestId('street-view-capture-selector').props.accessibilityLabel).toContain(
      'Mapillary',
    );

    // Dropdown lists captures newest-first.
    fireEvent.press(screen.getByTestId('street-view-capture-selector'));
    expect(screen.getByTestId('street-view-timeline')).toBeTruthy();
    expect(screen.getByTestId('street-view-capture-1').props.accessibilityLabel).toContain('2024');
    expect(screen.getByTestId('street-view-capture-2').props.accessibilityLabel).toContain('2023');

    // Selecting an earlier capture swaps the viewer and closes the dropdown.
    fireEvent.press(screen.getByTestId('street-view-capture-1'));
    await waitFor(() => expect(viewerLabel(screen)).toContain('https://pano.test/middle.jpg'));
    expect(screen.queryByTestId('street-view-timeline')).toBeNull();

    // Oldest capture is still reachable from the timeline.
    fireEvent.press(screen.getByTestId('street-view-capture-selector'));
    fireEvent.press(screen.getByTestId('street-view-capture-2'));
    await waitFor(() => expect(viewerLabel(screen)).toContain('https://pano.test/oldest.jpg'));
  });
});
