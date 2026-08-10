import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { useMapStore } from '../../src/stores/mapStore';

// ── Mock external dependencies ─────────────────────────────────────

// Control the API key at the module level so tests can toggle it.
let mockTomtomApiKey = 'test-api-key';

jest.mock('../../src/constants/config', () => ({
  get tomtomApiKey() {
    return mockTomtomApiKey;
  },
  TOMTOM_FLOW_TILES_BASE_URL: 'https://api.tomtom.com/traffic/map/4/tile/flow/absolute',
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
  }) => {
    return (
      <View
        testID="tomtom-traffic-source"
        accessibilityLabel={`src:${id} url:${tileUrlTemplates[0]} size:${tileSize} minz:${minZoomLevel} maxz:${maxZoomLevel}`}
      >
        {children}
      </View>
    );
  },
  RasterLayer: ({ id, style }: { id: string; style: Record<string, unknown> }) => {
    return (
      <View
        testID="tomtom-traffic-layer"
        accessibilityLabel={`layer:${id} opacity:${style.rasterOpacity}`}
      />
    );
  },
}));

// Import after mocks
import { TrafficOverlay } from '../../src/components/map/TrafficOverlay';

// ── Helpers ────────────────────────────────────────────────────────

function setTrafficVisible(visible: boolean) {
  useMapStore.setState({ trafficLayerVisible: visible });
}

function setApiKey(key: string) {
  mockTomtomApiKey = key;
}

/** Extract a labelled value from the accessibilityLabel of a test instance. */
function getAccessibilityLabelValue(
  instance: { props: { accessibilityLabel?: string } },
  key: string,
): string | undefined {
  const label: string = instance.props.accessibilityLabel ?? '';
  const regex = new RegExp(`${key}:([^ ]+)`);
  const match = label.match(regex);
  return match?.[1];
}

// ── Tests ──────────────────────────────────────────────────────────

describe('TrafficOverlay', () => {
  beforeEach(() => {
    // Reset to defaults
    setApiKey('test-api-key');
    useMapStore.setState({ trafficLayerVisible: false });
  });

  describe('when no API key is configured', () => {
    it('renders nothing (returns null)', () => {
      setApiKey('');

      const { queryByTestId } = render(<TrafficOverlay />);

      expect(queryByTestId('tomtom-traffic-source')).toBeNull();
      expect(queryByTestId('tomtom-traffic-layer')).toBeNull();
    });
  });

  describe('when an API key is configured', () => {
    it('renders the RasterSource and RasterLayer', () => {
      setTrafficVisible(true);

      const { getByTestId } = render(<TrafficOverlay />);

      expect(getByTestId('tomtom-traffic-source')).toBeTruthy();
      expect(getByTestId('tomtom-traffic-layer')).toBeTruthy();
    });

    it('passes the TomTom tile URL to RasterSource', () => {
      setTrafficVisible(true);
      setApiKey('my-secret-key');

      const { getByTestId } = render(<TrafficOverlay />);

      const source = getByTestId('tomtom-traffic-source');
      const url = getAccessibilityLabelValue(source, 'url');
      expect(url).toContain('key=my-secret-key');
      expect(url).toContain('tileSize=256');
      expect(url).toContain('thickness=3');
    });

    it('uses tileSize=256, minZoom=6, maxZoom=18', () => {
      setTrafficVisible(true);

      const { getByTestId } = render(<TrafficOverlay />);

      const source = getByTestId('tomtom-traffic-source');
      expect(getAccessibilityLabelValue(source, 'size')).toBe('256');
      expect(getAccessibilityLabelValue(source, 'minz')).toBe('6');
      expect(getAccessibilityLabelValue(source, 'maxz')).toBe('18');
    });

    it('sets raster opacity to 0.7 when traffic is visible and not suppressed', () => {
      setTrafficVisible(true);

      const { getByTestId } = render(<TrafficOverlay suppressRaster={false} />);

      const layer = getByTestId('tomtom-traffic-layer');
      expect(getAccessibilityLabelValue(layer, 'opacity')).toBe('0.7');
    });

    it('sets raster opacity to 0 when traffic is toggled off', () => {
      setTrafficVisible(false);

      const { getByTestId } = render(<TrafficOverlay />);

      const layer = getByTestId('tomtom-traffic-layer');
      expect(getAccessibilityLabelValue(layer, 'opacity')).toBe('0');
    });

    it('sets raster opacity to 0 when suppressRaster is true (even when visible)', () => {
      setTrafficVisible(true);

      const { getByTestId } = render(<TrafficOverlay suppressRaster={true} />);

      const layer = getByTestId('tomtom-traffic-layer');
      expect(getAccessibilityLabelValue(layer, 'opacity')).toBe('0');
    });

    it('still renders (not null) when traffic is off — just at opacity 0', () => {
      setTrafficVisible(false);

      const { getByTestId } = render(<TrafficOverlay />);

      // Component should still render (not return null) — opacity handles visibility
      expect(getByTestId('tomtom-traffic-source')).toBeTruthy();
      expect(getByTestId('tomtom-traffic-layer')).toBeTruthy();
    });
  });
});
