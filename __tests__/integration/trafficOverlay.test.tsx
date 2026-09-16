import React from 'react';
import { View as MockView } from 'react-native';
import { render } from '@testing-library/react-native';
import { useMapStore } from '../../src/stores/mapStore';
import { useTrafficStore } from '../../src/stores/trafficStore';

// ── Mock external dependencies ─────────────────────────────────────

// Control the API key at the module level so tests can toggle it.
let mockTomtomApiKey = 'test-api-key';

jest.mock('../../src/constants/config', () => ({
  get tomtomApiKey() {
    return mockTomtomApiKey;
  },
  TOMTOM_FLOW_TILES_BASE_URL: 'https://api.tomtom.com/traffic/map/4/tile/flow/absolute',
}));

// Control whether the local P2P/disk tile server is up.
let mockLocalTemplate: string | null = null;

jest.mock('../../src/services/traffic/trafficTileService', () => ({
  getTrafficTileUrlTemplate: () => mockLocalTemplate,
}));

jest.mock('@maplibre/maplibre-react-native', () => ({
  RasterSource: ({
    children,
    tileUrlTemplates,
    id,
    tileSize,
    minZoomLevel,
    maxZoomLevel,
  }: {
    children: React.ReactNode;
    tileUrlTemplates: string[];
    id: string;
    tileSize: number;
    minZoomLevel: number;
    maxZoomLevel: number;
  }) => (
    <MockView
      testID="traffic-source"
      accessibilityLabel={`src:${id} url:${tileUrlTemplates[0]} size:${tileSize} minz:${minZoomLevel} maxz:${maxZoomLevel}`}
    >
      {children}
    </MockView>
  ),
  RasterLayer: ({ id, style }: { id: string; style: Record<string, unknown> }) => (
    <MockView
      testID="traffic-layer"
      accessibilityLabel={`layer:${id} opacity:${style.rasterOpacity}`}
    />
  ),
}));

// Import after mocks
import { TrafficOverlay } from '../../src/components/map/TrafficOverlay';

// ── Helpers ────────────────────────────────────────────────────────

function setTrafficVisible(visible: boolean) {
  useMapStore.setState({ trafficLayerVisible: visible });
}

function getAccessibilityLabelValue(
  instance: { props: { accessibilityLabel?: string } },
  key: string,
): string | undefined {
  const label: string = instance.props.accessibilityLabel ?? '';
  const match = label.match(new RegExp(`${key}:([^ ]+)`));
  return match?.[1];
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TrafficOverlay', () => {
  beforeEach(() => {
    mockTomtomApiKey = 'test-api-key';
    mockLocalTemplate = null;
    useMapStore.setState({ trafficLayerVisible: false });
    useTrafficStore.setState({ trafficTileSeedVersion: 0 });
  });

  it('renders nothing when no TomTom key is configured and the local server is down', () => {
    mockTomtomApiKey = '';

    const { queryByTestId } = render(<TrafficOverlay />);

    expect(queryByTestId('traffic-source')).toBeNull();
    expect(queryByTestId('traffic-layer')).toBeNull();
  });

  it('renders nothing while the traffic layer is toggled off (no wasted tile fetches)', () => {
    const { queryByTestId } = render(<TrafficOverlay />);
    expect(queryByTestId('traffic-source')).toBeNull();
  });

  it('renders the TomTom cold-start source and layer when visible', () => {
    setTrafficVisible(true);

    const { getByTestId } = render(<TrafficOverlay />);

    expect(getByTestId('traffic-source')).toBeTruthy();
    expect(getByTestId('traffic-layer')).toBeTruthy();
    expect(getAccessibilityLabelValue(getByTestId('traffic-layer'), 'opacity')).toBe('0.7');
  });

  it('passes the TomTom cold-start tile URL and tile parameters', () => {
    setTrafficVisible(true);
    mockTomtomApiKey = 'my-secret-key';

    const { getByTestId } = render(<TrafficOverlay />);

    const source = getByTestId('traffic-source');
    const url = getAccessibilityLabelValue(source, 'url') ?? '';
    expect(url).toContain('key=my-secret-key');
    expect(url).toContain('tileSize=256');
    expect(url).toContain('thickness=3');
    expect(getAccessibilityLabelValue(source, 'size')).toBe('256');
    expect(getAccessibilityLabelValue(source, 'minz')).toBe('6');
    expect(getAccessibilityLabelValue(source, 'maxz')).toBe('18');
  });

  it('renders nothing when the raster is suppressed', () => {
    setTrafficVisible(true);

    const { queryByTestId } = render(<TrafficOverlay suppressRaster={true} />);

    expect(queryByTestId('traffic-source')).toBeNull();
  });

  it('prefers the local P2P tile server over TomTom and cache-busts by seed version', () => {
    setTrafficVisible(true);
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 3 });

    const { getByTestId } = render(<TrafficOverlay />);

    const url = getAccessibilityLabelValue(getByTestId('traffic-source'), 'url') ?? '';
    expect(url.startsWith('http://127.0.0.1:51234/traffic')).toBe(true);
    expect(url).toContain('v=3');
  });
});
