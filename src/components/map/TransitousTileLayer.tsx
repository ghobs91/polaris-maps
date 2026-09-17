import React, { Component, type ReactNode } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { TRANSITOUS_BASE_URL } from '../../constants/config';

/**
 * Transitous MOTIS vector-tile layer — global transit coverage for cities
 * without a dedicated/city-GTFS source. Tiles are rendered natively as a
 * MapLibre vector source; the JS route lines stay mounted so a tile failure
 * never removes the lines we already have.
 */

const SOURCE_ID = 'transitous-tiles';
const LINE_LAYER_ID = 'transitous-lines';
const STOP_LABEL_LAYER_ID = 'transitous-stop-labels';

/** `https://api.transitous.org/api` → `https://api.transitous.org/map/mapbox-gl-rt/{z}/{x}/{y}.mvt`. */
export function transitousTileUrlTemplate(baseUrl: string = TRANSITOUS_BASE_URL): string {
  const base = (baseUrl || 'https://api.transitous.org/api').replace(/\/api\/?$/, '');
  return `${base}/map/mapbox-gl-rt/{z}/{x}/{y}.mvt`;
}

const LINE_STYLE_VISIBLE = {
  lineColor: ['coalesce', ['get', 'color'], '#007AFF'] as any,
  lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 3, 16, 6] as any,
  lineOpacity: 0.9,
  visibility: 'visible' as const,
};
const LINE_STYLE_HIDDEN = { ...LINE_STYLE_VISIBLE, visibility: 'none' as const };

// Stops are only rendered when the tile schema actually carries named points;
// otherwise the filter matches nothing and the layer stays empty.
const STOP_LABEL_STYLE_VISIBLE = {
  textField: ['coalesce', ['get', 'name'], ['get', 'stop_name'], ['get', 'ref'], ''] as any,
  textSize: ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12] as any,
  textColor: '#FFFFFF',
  textHaloColor: '#000000',
  textHaloWidth: 1.2,
  textMaxWidth: 9,
  visibility: 'visible' as const,
};
const STOP_LABEL_STYLE_HIDDEN = { ...STOP_LABEL_STYLE_VISIBLE, visibility: 'none' as const };

class TileErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('[transitous] tile layer failed, hiding tiles:', error);
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function TransitousTileLayer({ visible }: { visible: boolean }) {
  return (
    <TileErrorBoundary>
      <MapLibreGL.VectorSource id={SOURCE_ID} tileUrlTemplates={[transitousTileUrlTemplate()]}>
        <MapLibreGL.LineLayer
          id={LINE_LAYER_ID}
          style={visible ? LINE_STYLE_VISIBLE : LINE_STYLE_HIDDEN}
        />
        <MapLibreGL.SymbolLayer
          id={STOP_LABEL_LAYER_ID}
          style={visible ? STOP_LABEL_STYLE_VISIBLE : STOP_LABEL_STYLE_HIDDEN}
        />
      </MapLibreGL.VectorSource>
    </TileErrorBoundary>
  );
}
