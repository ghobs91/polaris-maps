import React, { useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import {
  buildRouteTrafficGeoJSON,
  splitTrafficAtDistance,
  DEFAULT_ROUTE_COLOR,
  type TrafficFeatureCollection,
} from '../../services/traffic/routeTrafficService';
import { useTrafficStore } from '../../stores/trafficStore';
import { decodePolyline } from '../../utils/polyline';
import { useTheme } from '../../contexts/ThemeContext';
import {
  buildRibbon,
  splitRouteAtRemaining,
  COMPLETED_ROUTE_OPACITY,
  type RibbonBand,
} from './routeRibbon';

interface TrafficRouteLayerProps {
  geometry: string;
  /**
   * Widens the ribbon so it covers the carriageway it is drawn on. The road
   * fills grow under navigation too, and a ribbon narrower than its own road
   * reads as a stripe painted on the asphalt rather than the route.
   */
  navigationMode?: boolean;
  /**
   * Live distance left on the route. When supplied in navigation mode, the
   * stretch already driven is drawn dimmed behind the vehicle.
   */
  remainingDistanceMeters?: number | null;
}

function lineShape(coordinates: [number, number][]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates },
  };
}

const EMPTY_SHAPE = { type: 'FeatureCollection' as const, features: [] };

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
 *
 * While navigating, the route is split at the vehicle: the driven stretch is
 * rendered as a second, faded band stack so progress reads at a glance without
 * the route behind the car competing with the road ahead.
 */
export function TrafficRouteLayer({
  geometry,
  navigationMode = false,
  remainingDistanceMeters,
}: TrafficRouteLayerProps) {
  const normalizedSegments = useTrafficStore((s) => s.normalizedSegments);
  const { isDark } = useTheme();

  // Decode once for the fallback plain line
  const coordinates = useMemo(() => decodePolyline(geometry), [geometry]);

  const split = useMemo(
    () => (navigationMode ? splitRouteAtRemaining(coordinates, remainingDistanceMeters) : null),
    [navigationMode, coordinates, remainingDistanceMeters],
  );

  const remainingCoords = split?.remaining ?? coordinates;
  const completedCoords = split?.completed ?? null;

  const fallbackShape = useMemo(() => lineShape(remainingCoords), [remainingCoords]);
  const fallbackDoneShape = useMemo(
    () => (completedCoords ? lineShape(completedCoords) : EMPTY_SHAPE),
    [completedCoords],
  );

  // Build traffic-colored GeoJSON from store segments (reactive) for the whole
  // route — matching every point against every traffic segment is expensive, so
  // it runs only when the route or the traffic data changes, never on the
  // position stream. The driven stretch is carved out of this collection below.
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

  const trafficSplit = useMemo(
    () =>
      trafficGeoJSON && split
        ? splitTrafficAtDistance(trafficGeoJSON, split.completedMeters)
        : null,
    [trafficGeoJSON, split],
  );

  const trafficDoneGeoJSON = trafficSplit?.completed ?? null;

  const hasTraffic = !!trafficGeoJSON;

  const trafficAheadGeoJSON = trafficSplit?.remaining ?? trafficGeoJSON;

  const baseBands = useMemo(
    () => buildRibbon('route-base', DEFAULT_ROUTE_COLOR, isDark, !hasTraffic, navigationMode),
    [isDark, hasTraffic, navigationMode],
  );

  const trafficBands = useMemo(
    () => buildRibbon('route-traffic', ['get', 'color'] as any, isDark, hasTraffic, navigationMode),
    [isDark, hasTraffic, navigationMode],
  );

  const baseDoneBands = useMemo(
    () =>
      buildRibbon(
        'route-base-done',
        DEFAULT_ROUTE_COLOR,
        isDark,
        !hasTraffic,
        navigationMode,
        COMPLETED_ROUTE_OPACITY,
      ),
    [isDark, hasTraffic, navigationMode],
  );

  const trafficDoneBands = useMemo(
    () =>
      buildRibbon(
        'route-traffic-done',
        ['get', 'color'] as any,
        isDark,
        hasTraffic,
        navigationMode,
        COMPLETED_ROUTE_OPACITY,
      ),
    [isDark, hasTraffic, navigationMode],
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

      {/* Driven stretch of the fallback ribbon, faded behind the vehicle. */}
      <MapLibreGL.ShapeSource id="route-base-done" shape={fallbackDoneShape as any}>
        {renderBands(baseDoneBands)}
      </MapLibreGL.ShapeSource>

      {/* Traffic-colored segments — always mounted so MapLibre layers
          persist; toggled on/off via opacity to avoid mount/remount. */}
      <MapLibreGL.ShapeSource
        id="route-traffic"
        shape={(trafficAheadGeoJSON || EMPTY_SHAPE) as any}
      >
        {renderBands(trafficBands)}
      </MapLibreGL.ShapeSource>

      {/* Driven stretch of the traffic ribbon, faded behind the vehicle. */}
      <MapLibreGL.ShapeSource
        id="route-traffic-done"
        shape={(trafficDoneGeoJSON || EMPTY_SHAPE) as any}
      >
        {renderBands(trafficDoneBands)}
      </MapLibreGL.ShapeSource>
    </>
  );
}
