import React from 'react';
import { render } from '@testing-library/react-native';
import { useTrafficStore } from '../../src/stores/trafficStore';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

// Mock MapLibreGL components
jest.mock('@maplibre/maplibre-react-native', () => ({
  ShapeSource: ({
    children,
    shape,
  }: {
    children: React.ReactNode;
    shape: GeoJSON.FeatureCollection;
  }) => {
    // Expose shape for assertions via testID
    return (
      <mock-shape-source testID="traffic-shape-source" data-shape={JSON.stringify(shape)}>
        {children}
      </mock-shape-source>
    );
  },
  LineLayer: ({ style }: { style: Record<string, unknown> }) => {
    return <mock-line-layer testID="traffic-line-layer" data-style={JSON.stringify(style)} />;
  },
}));

// Import after mocks
import { TrafficOverlay } from '../../src/components/map/TrafficOverlay';

const MOCK_SEGMENTS: NormalizedTrafficSegment[] = [
  {
    id: 'tomtom:abc123',
    coordinates: [
      [4.84, 52.41],
      [4.85, 52.42],
    ],
    currentSpeedMph: 45,
    freeFlowSpeedMph: 60,
    congestionRatio: 0.75,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: 1000000,
  },
  {
    id: 'tomtom:def456',
    coordinates: [
      [4.86, 52.43],
      [4.87, 52.44],
    ],
    currentSpeedMph: 10,
    freeFlowSpeedMph: 60,
    congestionRatio: 0.167,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: 1000000,
  },
];

describe('TrafficOverlay', () => {
  beforeEach(() => {
    useTrafficStore.setState({
      normalizedSegments: [],
      segmentTraffic: {},
    });
  });

  it('renders nothing when there are no normalized segments', () => {
    const { queryByTestId } = render(<TrafficOverlay />);
    expect(queryByTestId('traffic-shape-source')).toBeNull();
  });

  it('renders ShapeSource and LineLayer when segments are available', () => {
    useTrafficStore.setState({ normalizedSegments: MOCK_SEGMENTS });
    const { getByTestId } = render(<TrafficOverlay />);

    expect(getByTestId('traffic-shape-source')).toBeTruthy();
    expect(getByTestId('traffic-line-layer')).toBeTruthy();
  });

  it('creates LineString features from normalized segments', () => {
    useTrafficStore.setState({ normalizedSegments: MOCK_SEGMENTS });
    const { getByTestId } = render(<TrafficOverlay />);

    const shapeSource = getByTestId('traffic-shape-source');
    const shape = JSON.parse(shapeSource.props['data-shape']);

    expect(shape.type).toBe('FeatureCollection');
    expect(shape.features).toHaveLength(2);
    expect(shape.features[0].geometry.type).toBe('LineString');
    expect(shape.features[0].properties.congestionRatio).toBe(0.75);
    expect(shape.features[1].properties.congestionRatio).toBeCloseTo(0.167, 2);
  });
});
