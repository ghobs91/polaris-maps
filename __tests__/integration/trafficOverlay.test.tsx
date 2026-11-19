import React from 'react';
import { View as MockView } from 'react-native';
import { act, render } from '@testing-library/react-native';
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
const mockEnsureTrafficTileServer = jest.fn(() => Promise.resolve<string | null>(null));

jest.mock('../../src/services/traffic/trafficTileService', () => ({
  getTrafficTileUrlTemplate: () => mockLocalTemplate,
  ensureTrafficTileServer: () => mockEnsureTrafficTileServer(),
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
    mockEnsureTrafficTileServer.mockClear();
    useMapStore.setState({ trafficLayerVisible: false });
    useTrafficStore.setState({ trafficTileSeedVersion: 0 });
  });

  it('starts the local tile server itself instead of waiting on P2P init', () => {
    // `initTrafficP2P` starts the server, but it runs behind
    // InteractionManager *and* an awaited remote-config fetch, so the overlay
    // used to point at the provider for the first ~2.5 s: those tiles were
    // bought outside our disk cache and the layer then vanished when the
    // source URL switched to the local server.
    mockLocalTemplate = null;

    render(<TrafficOverlay />);

    expect(mockEnsureTrafficTileServer).toHaveBeenCalled();
  });

  it('does not restart the server when it is already up', () => {
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';

    render(<TrafficOverlay />);

    expect(mockEnsureTrafficTileServer).not.toHaveBeenCalled();
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

  it('renders from the local tile server even with no TomTom key configured', () => {
    // A device with no API key still receives traffic tiles from the mesh and
    // from its own disk cache; requiring the key hid the layer entirely.
    setTrafficVisible(true);
    mockTomtomApiKey = '';
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 2 });

    const { getByTestId } = render(<TrafficOverlay />);

    expect(getByTestId('traffic-source')).toBeTruthy();
  });

  it('waits for the first seeded tile before mounting the local source', () => {
    // Mounting before any PNG exists can only produce 404s, and a 404 that the
    // map has already answered is not retried on its own.
    setTrafficVisible(true);
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 0 });

    const { queryByTestId } = render(<TrafficOverlay />);

    expect(queryByTestId('traffic-source')).toBeNull();
  });

  it('caps the local source at the seeded zoom so deeper zooms overzoom', () => {
    setTrafficVisible(true);
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 1 });

    const { getByTestId } = render(<TrafficOverlay />);

    expect(getAccessibilityLabelValue(getByTestId('traffic-source'), 'maxz')).toBe('14');
  });

  it('draws the local source from the zoom seeding actually starts at', () => {
    // Seeding clamps to MIN_TRAFFIC_TILE_ZOOM. A source that refused to draw
    // below zoom 6 left the wide view empty while z4 tiles were downloaded.
    setTrafficVisible(true);
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 1 });

    const { getByTestId } = render(<TrafficOverlay />);

    expect(getAccessibilityLabelValue(getByTestId('traffic-source'), 'minz')).toBe('4');
  });

  it('remounts the source when a new tile is seeded so MapLibre re-requests it', () => {
    // The native source is created once and never re-reads tileUrlTemplates,
    // so the seed version has to rebuild the source for late tiles to appear.
    setTrafficVisible(true);
    mockLocalTemplate = 'http://127.0.0.1:51234/traffic';
    useTrafficStore.setState({ trafficTileSeedVersion: 1 });

    const { getByTestId, rerender } = render(<TrafficOverlay />);
    const beforeLabel = getByTestId('traffic-source').props.accessibilityLabel as string;

    act(() => {
      useTrafficStore.setState({ trafficTileSeedVersion: 2 });
    });
    rerender(<TrafficOverlay />);

    const after = getByTestId('traffic-source');
    expect(getAccessibilityLabelValue(after, 'url')).toContain('v=2');
    // A fresh source instance, not the same view with new props: the native
    // source is only built on mount.
    expect(after.props.accessibilityLabel).not.toBe(beforeLabel);
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
