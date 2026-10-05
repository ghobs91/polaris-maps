import React from 'react';
import { View as MockView } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { useOsmPoiStore } from '../../src/stores/osmPoiStore';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';
import type { ViewportBounds } from '../../src/utils/poiSpatialFilter';

// MarkerView just needs to render its children; the badge is what we assert on.
jest.mock('@maplibre/maplibre-react-native', () => ({
  __esModule: true,
  default: {
    MarkerView: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000000' } }),
}));

// Import after mocks.
import { POILayer } from '../../src/components/map/POILayer';

// Two POIs ~2km apart so both stay isolated at the low zooms used below.
const BOUNDS: ViewportBounds = {
  minLat: 40.7,
  maxLat: 40.78,
  minLng: -73.99,
  maxLng: -73.95,
};

function makePoi(id: number, name: string, lat: number, lng: number): OsmPoi {
  return {
    id,
    name,
    lat,
    lng,
    type: 'amenity',
    subtype: 'cafe',
    tags: {},
  };
}

function setPois(pois: OsmPoi[], zoom: number, searchResults: OsmPoi[] | null = null) {
  act(() => {
    useOsmPoiStore.setState({
      pois,
      categorySearchResults: searchResults,
      currentZoom: zoom,
      viewportBounds: BOUNDS,
    });
  });
}

afterEach(() => {
  useOsmPoiStore.getState().clearCategorySearch();
  useOsmPoiStore.setState({ pois: [], currentZoom: 0, viewportBounds: null });
});

describe('POILayer name pills', () => {
  it('shows the name pill for isolated viewport POIs below street level', () => {
    // Zoom 14 is below STREET_LEVEL_POI_ZOOM (17), i.e. the clustering branch.
    setPois(
      [makePoi(1, 'Corner Cafe', 40.705, -73.985), makePoi(2, 'Uptown Roasters', 40.775, -73.955)],
      14,
    );

    const screen = render(<POILayer />);

    expect(screen.getByText('Corner Cafe')).toBeTruthy();
    expect(screen.getByText('Uptown Roasters')).toBeTruthy();
  });

  it('shows the name pill for a low-zoom search suggestion pin', () => {
    const suggestion = makePoi(99, 'Suggested Coffee', 40.742, -73.97);
    setPois([suggestion], 13, [suggestion]);

    const screen = render(<POILayer />);

    expect(screen.getByText('Suggested Coffee')).toBeTruthy();
  });
});
