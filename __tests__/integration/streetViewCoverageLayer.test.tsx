import React from 'react';
import { render } from '@testing-library/react-native';

// MMKV backs the street-view store; stub the native module for the test env.
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getBoolean: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

let mockMapillaryConfigured = false;
jest.mock('../../src/services/imagery/streetViewService', () => ({
  isMapillaryConfigured: () => mockMapillaryConfigured,
}));

jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: 'test-token',
  PANORAMAX_TILES_URL: 'https://panoramax.test/{z}/{x}/{y}.mvt',
  mapillaryCoverageTileUrl: (token: string) =>
    `https://mapillary.test/{z}/{x}/{y}?access_token=${token}`,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@maplibre/maplibre-react-native', () => {
  const ReactLocal = jest.requireActual('react') as typeof React;
  const { View } = jest.requireActual('react-native') as typeof import('react-native');
  const makeLayer =
    (kind: 'line' | 'circle') =>
    (props: {
      id: string;
      sourceLayerID: string;
      filter?: unknown;
      style?: Record<string, unknown>;
    }) =>
      ReactLocal.createElement(View, {
        testID: `${kind}-layer`,
        accessibilityLabel: JSON.stringify({
          id: props.id,
          sourceLayerID: props.sourceLayerID,
          filter: props.filter,
          color: kind === 'line' ? props.style?.lineColor : props.style?.circleColor,
        }),
      });
  return {
    VectorSource: (props: { id: string; tileUrlTemplates: string[]; children?: React.ReactNode }) =>
      ReactLocal.createElement(
        View,
        {
          testID: `source-${props.id}`,
          accessibilityLabel: JSON.stringify({ id: props.id, tiles: props.tileUrlTemplates }),
        },
        props.children,
      ),
    LineLayer: makeLayer('line'),
    CircleLayer: makeLayer('circle'),
  };
});

import { StreetViewCoverageLayer } from '../../src/components/map/StreetViewCoverageLayer';
import { useStreetViewStore } from '../../src/stores/streetViewStore';

interface LayerInfo {
  id: string;
  sourceLayerID: string;
  filter: unknown;
  color?: string;
}

function layerInfo(node: { props: { accessibilityLabel?: string } }): LayerInfo {
  return JSON.parse(node.props.accessibilityLabel ?? '{}') as LayerInfo;
}

function allLayers(screen: ReturnType<typeof render>): LayerInfo[] {
  return [...screen.queryAllByTestId('line-layer'), ...screen.queryAllByTestId('circle-layer')].map(
    layerInfo,
  );
}

const PANO_PANO_FILTER = ['==', ['get', 'type'], 'equirectangular'];
const MAP_PANO_FILTER = ['==', ['get', 'is_pano'], true];
const UNIFIED_COLOR = '#35AF6D';

describe('StreetViewCoverageLayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMapillaryConfigured = false;
    useStreetViewStore.setState({ streetViewLayerVisible: true });
  });

  it('renders nothing while the layer is toggled off', () => {
    useStreetViewStore.setState({ streetViewLayerVisible: false });

    const screen = render(<StreetViewCoverageLayer />);

    expect(screen.queryByTestId('source-streetViewCoveragePanoramax')).toBeNull();
    expect(screen.queryAllByTestId('line-layer')).toHaveLength(0);
  });

  it('draws only equirectangular Panoramax coverage, in one unified colour', () => {
    const screen = render(<StreetViewCoverageLayer />);

    expect(screen.getByTestId('source-streetViewCoveragePanoramax')).toBeTruthy();
    expect(screen.queryByTestId('source-streetViewCoverageMapillary')).toBeNull();

    const layers = allLayers(screen);
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.filter).toEqual(PANO_PANO_FILTER);
      expect(layer.color).toBe(UNIFIED_COLOR);
    }
  });

  it('adds Mapillary coverage only when configured, filtered to panoramic sequences', () => {
    mockMapillaryConfigured = true;

    const screen = render(<StreetViewCoverageLayer />);

    expect(screen.getByTestId('source-streetViewCoverageMapillary')).toBeTruthy();

    const lines = screen.getAllByTestId('line-layer').map(layerInfo);
    const mapLine = lines.find((l) => l.sourceLayerID === 'sequence');
    expect(mapLine?.filter).toEqual(MAP_PANO_FILTER);
    expect(mapLine?.color).toBe(UNIFIED_COLOR);

    const circles = screen.getAllByTestId('circle-layer').map(layerInfo);
    const mapOverview = circles.find((l) => l.sourceLayerID === 'overview');
    expect(mapOverview?.filter).toEqual(MAP_PANO_FILTER);
    expect(mapOverview?.color).toBe(UNIFIED_COLOR);
  });
});
