import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import {
  buildRouteTrafficGeoJSON,
  DEFAULT_ROUTE_COLOR,
  type TrafficFeatureCollection,
} from '../../services/traffic/routeTrafficService';
import { useTrafficStore } from '../../stores/trafficStore';
import { decodePolyline } from '../../utils/polyline';
import { useTheme } from '../../contexts/ThemeContext';
import { buildRibbon, type RibbonBand } from './routeRibbon';

interface TrafficRouteLayerProps {
  geometry: string;
  /**
   * Widens the ribbon so it covers the carriageway it is drawn on. The road
   * fills grow under navigation too, and a ribbon narrower than its own road
   * reads as a stripe painted on the asphalt rather than the route.
   */
  navigationMode?: boolean;
}

/**
 * Renders the route as color-coded line segments based on live traffic data
 * from the traffic store.  Intended to be placed inside a MapLibreGL.MapView.
 *
 * Always shows a plain blue fallback line immediately so the route is visible
 * while traffic data is loading or if no data is available.  Once the traffic
 * store has normalized segments nearby, colored segments are rendered on top.
 *
 * Both sources render the identical band stack so the crossfade from fallback
 * to traffic colours is invisible. See `routeRibbon` for the widths.
 */
export function TrafficRouteLayer({ geometry, navigationMode = false }: TrafficRouteLayerProps) {
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);
  const { isDark } = useTheme();

  // Decode once for the fallback plain line
  const coordinates = useMemo(() => decodePolyline(geometry), [geometry]);

  const fallbackShape = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates },
    }),
    [coordinates],
  );

  // Build traffic-colored GeoJSON from store segments (reactive)
  const trafficGeoJSON: TrafficFeatureCollection | null = useMemo(() => {
    if (normalizedSegments.length === 0) {
      if (__DEV__) console.log('[TrafficRouteLayer] no segments yet');
      return null;
    }
    const result = buildRouteTrafficGeoJSON(coordinates, normalizedSegments);
    if (__DEV__)
      console.log(
        `[TrafficRouteLayer] ${normalizedSegments.length} segments → ${result.features.length} features; 1st color: ${result.features[0]?.properties.color}`,
      );
    return result.features.length > 0 ? result : null;
  }, [coordinates, normalizedSegments]);

  const hasTraffic = !!trafficGeoJSON;

  const baseBands = useMemo(
    () => buildRibbon('route-base', DEFAULT_ROUTE_COLOR, isDark, !hasTraffic, navigationMode),
    [isDark, hasTraffic, navigationMode],
  );

  const trafficBands = useMemo(
    () => buildRibbon('route-traffic', ['get', 'color'] as any, isDark, hasTraffic, navigationMode),
    [isDark, hasTraffic, navigationMode],
  );

  // Empty shape for the traffic source so it's always mounted — avoids
  // MapLibre unmount/remount issues when switching from fallback to colored.
  const emptyTrafficShape = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: [] }),
    [],
  );

  const renderBands = (bands: RibbonBand[]) =>
    bands.map((band) => (
      <MapLibreGL.LineLayer
        key={band.id}
        id={band.id}
        style={{
          lineColor: band.color as any,
          lineWidth: band.width as any,
          lineCap: 'round',
          lineJoin: 'round',
          lineOpacity: band.opacity,
        }}
      />
    ));

  return (
    <>
      {/* Plain fallback ribbon — visible only while traffic data is loading */}
      <MapLibreGL.ShapeSource id="route-base" shape={fallbackShape}>
        {renderBands(baseBands)}
      </MapLibreGL.ShapeSource>

      {/* Traffic-colored segments — always mounted so MapLibre layers
          persist; toggled on/off via opacity to avoid mount/remount. */}
      <MapLibreGL.ShapeSource
        id="route-traffic"
        shape={(trafficGeoJSON || emptyTrafficShape) as any}
      >
        {renderBands(trafficBands)}
      </MapLibreGL.ShapeSource>
    </>
  );
}
