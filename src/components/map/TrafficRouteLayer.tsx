import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import {
  buildRouteTrafficGeoJSON,
  type TrafficFeatureCollection,
} from '../../services/traffic/routeTrafficService';
import { useTrafficStore } from '../../stores/trafficStore';
import { decodePolyline } from '../../utils/polyline';

interface TrafficRouteLayerProps {
  geometry: string;
}

/**
 * Renders the route as color-coded line segments based on live traffic data
 * from the traffic store.  Intended to be placed inside a MapLibreGL.MapView.
 *
 * Always shows a plain blue fallback line immediately so the route is visible
 * while traffic data is loading or if no data is available.  Once the traffic
 * store has normalized segments nearby, colored segments are rendered on top.
 */
export function TrafficRouteLayer({ geometry }: TrafficRouteLayerProps) {
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);

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
      console.log('[TrafficRouteLayer] no segments yet');
      return null;
    }
    const result = buildRouteTrafficGeoJSON(coordinates, normalizedSegments);
    console.log(
      `[TrafficRouteLayer] ${normalizedSegments.length} segments → ${result.features.length} features; 1st color: ${result.features[0]?.properties.color}`,
    );
    return result.features.length > 0 ? result : null;
  }, [coordinates, normalizedSegments]);

  const hasTraffic = !!trafficGeoJSON;

  // Empty shape for the traffic source so it's always mounted — avoids
  // MapLibre unmount/remount issues when switching from fallback to colored.
  const emptyTrafficShape = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: [] }),
    [],
  );

  return (
    <>
      {/* Plain blue fallback — visible only while traffic data is loading */}
      <MapLibreGL.ShapeSource id="route-base" shape={fallbackShape}>
        <MapLibreGL.LineLayer
          id="route-base-casing"
          style={{
            lineColor: '#ffffff',
            lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 11] as any,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasTraffic ? 0 : 1,
          }}
        />
        <MapLibreGL.LineLayer
          id="route-base-line"
          style={{
            lineColor: '#4A8CFF',
            lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7.5] as any,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasTraffic ? 0 : 1,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Traffic-colored segments — always mounted so MapLibre layers
          persist; toggled on/off via opacity to avoid mount/remount. */}
      <MapLibreGL.ShapeSource
        id="route-traffic"
        shape={(trafficGeoJSON || emptyTrafficShape) as any}
      >
        <MapLibreGL.LineLayer
          id="route-traffic-casing"
          style={{
            lineColor: '#ffffff',
            lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 11] as any,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasTraffic ? 1 : 0,
          }}
        />
        <MapLibreGL.LineLayer
          id="route-traffic-line"
          style={{
            lineColor: ['get', 'color'] as any,
            lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7.5] as any,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasTraffic ? 1 : 0,
          }}
        />
      </MapLibreGL.ShapeSource>
    </>
  );
}
