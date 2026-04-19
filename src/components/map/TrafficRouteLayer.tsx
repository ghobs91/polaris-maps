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
    if (normalizedSegments.length === 0) return null;
    const result = buildRouteTrafficGeoJSON(coordinates, normalizedSegments);
    return result.features.length > 0 ? result : null;
  }, [coordinates, normalizedSegments]);

  const hasTraffic = !!trafficGeoJSON;

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
            lineColor: '#4A90D9',
            lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7.5] as any,
            lineCap: 'round',
            lineJoin: 'round',
            lineOpacity: hasTraffic ? 0 : 1,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Traffic-colored segments — rendered on top once data is available */}
      {trafficGeoJSON && (
        <MapLibreGL.ShapeSource id="route-traffic" shape={trafficGeoJSON as any}>
          <MapLibreGL.LineLayer
            id="route-traffic-casing"
            style={{
              lineColor: '#ffffff',
              lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 11] as any,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
          <MapLibreGL.LineLayer
            id="route-traffic-line"
            style={{
              lineColor: ['get', 'color'] as any,
              lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4.5, 17, 7.5] as any,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </MapLibreGL.ShapeSource>
      )}
    </>
  );
}
