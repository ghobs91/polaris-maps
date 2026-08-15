import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useMapStore } from '../../stores/mapStore';
import { TOMTOM_FLOW_TILES_BASE_URL } from '../../constants/config';

/**
 * Resolve the TomTom API key at call time rather than at module import.
 * This guards against the value being empty when the JS bundle evaluates
 * before Expo's env-var inlining completes (e.g. in development builds).
 */
function getTomtomApiKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tomtomApiKey } = require('../../constants/config');
  return typeof tomtomApiKey === 'string' ? tomtomApiKey : '';
}

interface TrafficOverlayProps {
  /** When true, forces the raster layer to opacity 0 (e.g. when traffic is
   *  shown on the route line instead of the whole map). */
  suppressRaster?: boolean;
}

export function TrafficOverlay({ suppressRaster = false }: TrafficOverlayProps) {
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);

  const apiKey = getTomtomApiKey();

  const tileUrl = useMemo(() => {
    if (!apiKey) return '';
    const encodedKey = encodeURIComponent(apiKey);
    return `${TOMTOM_FLOW_TILES_BASE_URL}/{z}/{x}/{y}.png?key=${encodedKey}&tileSize=256&thickness=3`;
  }, [apiKey]);

  if (!apiKey) {
    console.warn(
      '[TrafficOverlay] No TomTom API key configured. Set EXPO_PUBLIC_TOMTOM_API_KEY in .env',
    );
    return null;
  }

  const opacity = suppressRaster || !trafficLayerVisible ? 0 : 0.7;

  const keyPreview = apiKey.length >= 6 ? apiKey.slice(0, 6) + '...' : '(empty)';
  console.log(
    `[TrafficOverlay] visible=${trafficLayerVisible} suppress=${suppressRaster} opacity=${opacity} key=${keyPreview} url=${tileUrl.slice(0, 80)}...`,
  );

  return (
    <MapLibreGL.RasterSource
      id="tomtom-traffic"
      tileUrlTemplates={[tileUrl]}
      tileSize={256}
      minZoomLevel={6}
      maxZoomLevel={18}
    >
      <MapLibreGL.RasterLayer
        id="tomtom-traffic-layer"
        sourceID="tomtom-traffic"
        style={{ rasterOpacity: opacity }}
      />
    </MapLibreGL.RasterSource>
  );
}
