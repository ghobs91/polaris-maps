import React, { useEffect, useRef, useState } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { fetchRouteTrafficGeoJSON } from '../../services/traffic/routeTrafficService';
import { decodePolyline } from '../../utils/polyline';

/** How often (ms) to re-fetch traffic conditions along the route. */
const REFRESH_INTERVAL_MS = 60_000;

interface TrafficRouteLayerProps {
  geometry: string;
}

type TrafficGeoJSON = NonNullable<Awaited<ReturnType<typeof fetchRouteTrafficGeoJSON>>>;

/**
 * Renders the route as color-coded line segments based on live TomTom traffic
 * flow data.  Intended to be placed inside a MapLibreGL.MapView.
 *
 * Always shows a plain blue fallback line immediately so the route is visible
 * while traffic data is loading or if the API is unavailable.  Once traffic
 * data arrives, the colored segments are rendered on top.
 */
export function TrafficRouteLayer({ geometry }: TrafficRouteLayerProps) {
  const [geoJSON, setGeoJSON] = useState<TrafficGeoJSON | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Reset when geometry changes so we don't flash stale colors
    setGeoJSON(null);
    let cancelled = false;

    const load = async () => {
      const data = await fetchRouteTrafficGeoJSON(geometry);
      if (!cancelled && data) setGeoJSON(data);
    };

    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [geometry]);

  // Decode once for the fallback plain line
  const coordinates = decodePolyline(geometry);
  const fallbackShape = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates },
  };

  return (
    <>
      {/* Plain blue fallback — always visible so the route shows immediately */}
      <MapLibreGL.ShapeSource id="route-base" shape={fallbackShape}>
        <MapLibreGL.LineLayer
          id="route-base-casing"
          style={{ lineColor: '#ffffff', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }}
        />
        <MapLibreGL.LineLayer
          id="route-base-line"
          style={{ lineColor: '#4A90D9', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }}
        />
      </MapLibreGL.ShapeSource>

      {/* Traffic-colored segments — rendered on top once data is available */}
      {geoJSON && (
        <MapLibreGL.ShapeSource id="route-traffic" shape={geoJSON as any}>
          <MapLibreGL.LineLayer
            id="route-traffic-casing"
            style={{ lineColor: '#ffffff', lineWidth: 10, lineCap: 'round', lineJoin: 'round' }}
          />
          <MapLibreGL.LineLayer
            id="route-traffic-line"
            style={{
              lineColor: ['get', 'color'] as any,
              lineWidth: 6,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </MapLibreGL.ShapeSource>
      )}
    </>
  );
}
