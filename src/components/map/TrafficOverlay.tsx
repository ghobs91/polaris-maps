import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useMapStore } from '../../stores/mapStore';
import { tomtomApiKey, TOMTOM_FLOW_TILES_BASE_URL } from '../../constants/config';

interface TrafficOverlayProps {
  /** When true, forces the raster layer to opacity 0 (e.g. when traffic is
   *  shown on the route line instead of the whole map). */
  suppressRaster?: boolean;
}

export function TrafficOverlay({ suppressRaster = false }: TrafficOverlayProps) {
  const trafficLayerVisible = useMapStore((s) => s.trafficLayerVisible);

  const tileUrl = useMemo(
    () =>
      `${TOMTOM_FLOW_TILES_BASE_URL}/{z}/{x}/{y}.png?key=${tomtomApiKey}&tileSize=256&thickness=10`,
    [],
  );

  if (!tomtomApiKey) return null;

  const opacity = suppressRaster || !trafficLayerVisible ? 0 : 0.7;

  return (
    <MapLibreGL.RasterSource
      id="tomtom-traffic"
      tileUrlTemplates={[tileUrl]}
      tileSize={256}
      minZoomLevel={6}
      maxZoomLevel={18}
    >
      <MapLibreGL.RasterLayer id="tomtom-traffic-layer" style={{ rasterOpacity: opacity }} />
    </MapLibreGL.RasterSource>
  );
}
