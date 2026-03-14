import React, { useRef, useCallback, useEffect } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';
import { useMapStore } from '../../stores/mapStore';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { fetchOsmPois } from '../../services/poi/osmFetcher';
import { OPENFREEMAP_STYLE_URL, MAP_STYLE_URL_DARK } from '../../constants/config';
import { colors } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { TrafficOverlay } from './TrafficOverlay';
import { TrafficRouteLayer } from './TrafficRouteLayer';
import { POILayer } from './POILayer';

const POI_MIN_ZOOM = 14;
const POI_FETCH_DEBOUNCE_MS = 600;

interface MapViewProps {
  routeGeometry?: string;
  onMapPress?: (lat: number, lng: number) => void;
  /** When true, tilts the camera, hides user dot, shows chevron at navPosition */
  navigationMode?: boolean;
  /** Current position of the navigation chevron [lng, lat] */
  navPosition?: [number, number] | null;
  /** Bearing in degrees (0 = north, 90 = east) for heading-up rotation */
  navBearing?: number;
}

export function MapView({
  routeGeometry,
  onMapPress,
  navigationMode,
  navPosition,
  navBearing = 0,
}: MapViewProps) {
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const { isDark } = useTheme();
  const viewport = useMapStore((s) => s.viewport);
  const selectedLocation = useMapStore((s) => s.selectedLocation);
  // Track the last programmatic viewport change to fly to
  const lastProgrammaticMove = useRef(0);
  // Debounce timer for OSM POI fetching
  const poiFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In navigation mode, follow navPosition with tilt + heading
  useEffect(() => {
    if (!navigationMode || !navPosition || !cameraRef.current) return;
    cameraRef.current.setCamera({
      centerCoordinate: navPosition,
      zoomLevel: 17,
      heading: navBearing,
      pitch: 55,
      animationDuration: 800,
      animationMode: 'flyTo',
    });
  }, [navigationMode, navPosition, navBearing]);

  // Listen for programmatic viewport changes (locate, search select) and fly to them
  useEffect(() => {
    const unsub = useMapStore.subscribe((state, prev) => {
      if (!cameraRef.current) return;

      // Handle fitBounds requests (route overview zoom)
      if (state.fitBounds && state.fitBounds !== prev.fitBounds) {
        const [minLng, minLat, maxLng, maxLat] = state.fitBounds;
        cameraRef.current.fitBounds(
          [maxLng, maxLat], // NE
          [minLng, minLat], // SW
          60, // padding
          500, // duration ms
        );
        // Clear after applying so it can be re-triggered
        useMapStore.getState().setFitBounds(null);
        return;
      }

      if (state.viewport !== prev.viewport) {
        // Only animate if this is a programmatic change (zoom/lat/lng changed materially)
        const v = state.viewport;
        const p = prev.viewport;
        const latChanged = Math.abs(v.lat - p.lat) > 0.0001;
        const lngChanged = Math.abs(v.lng - p.lng) > 0.0001;
        const zoomChanged = Math.abs(v.zoom - p.zoom) >= 0.5;
        if (latChanged || lngChanged || zoomChanged) {
          lastProgrammaticMove.current = Date.now();
          cameraRef.current.setCamera({
            centerCoordinate: [v.lng, v.lat],
            zoomLevel: v.zoom,
            heading: v.bearing,
            pitch: v.pitch,
            animationDuration: 500,
            animationMode: 'flyTo',
          });
        }
      }
    });
    return unsub;
  }, []);

  const handleRegionDidChange = useCallback((event: any) => {
    const zoom: number = event?.properties?.zoomLevel ?? 0;
    if (zoom < POI_MIN_ZOOM) {
      // Clear POIs when zoomed out
      useOsmPoiStore.getState().setPois([]);
      return;
    }
    const bounds: [[number, number], [number, number]] | undefined =
      event?.properties?.visibleBounds;
    if (!bounds) return;
    const [[maxLng, maxLat], [minLng, minLat]] = bounds;

    // Store current zoom + bounds so POILayer can filter for even distribution
    useOsmPoiStore.getState().setZoomAndBounds(zoom, { minLat, minLng, maxLat, maxLng });

    if (poiFetchTimer.current) clearTimeout(poiFetchTimer.current);
    poiFetchTimer.current = setTimeout(async () => {
      try {
        useOsmPoiStore.getState().setIsLoading(true);
        const pois = await fetchOsmPois(minLat, minLng, maxLat, maxLng);
        useOsmPoiStore.getState().setPois(pois);
      } catch {
        // Silently ignore — Overpass may be unavailable
      } finally {
        useOsmPoiStore.getState().setIsLoading(false);
      }
    }, POI_FETCH_DEBOUNCE_MS);
  }, []);

  const handlePress = useCallback(
    (event: any) => {
      const [lng, lat] = event.geometry.coordinates as [number, number];
      onMapPress?.(lat, lng);
    },
    [onMapPress],
  );

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={isDark ? MAP_STYLE_URL_DARK : OPENFREEMAP_STYLE_URL}
        onPress={handlePress}
        onRegionDidChange={handleRegionDidChange}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [viewport.lng, viewport.lat],
            zoomLevel: viewport.zoom,
            heading: viewport.bearing,
            pitch: viewport.pitch,
          }}
        />

        <MapLibreGL.UserLocation visible={!navigationMode} />

        {/* Suppress raster overlay when traffic is shown on the route line instead */}
        <TrafficOverlay suppressRaster={!!routeGeometry} />

        {/* Navigation chevron as a map annotation */}
        {navigationMode && navPosition && (
          <MapLibreGL.PointAnnotation
            id="navChevron"
            coordinate={navPosition}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={chevronStyles.container}>
              <View style={chevronStyles.triangle} />
              <View style={chevronStyles.glow} />
            </View>
          </MapLibreGL.PointAnnotation>
        )}

        {selectedLocation && (
          <MapLibreGL.ShapeSource
            id="selectedLocation"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Point',
                coordinates: [selectedLocation.lng, selectedLocation.lat],
              },
            }}
          >
            <MapLibreGL.CircleLayer
              id="selectedLocationPin"
              style={{
                circleRadius: 10,
                circleColor: colors.primary,
                circleStrokeWidth: 3,
                circleStrokeColor: colors.white,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {routeGeometry && <TrafficRouteLayer geometry={routeGeometry} />}

        <POILayer />
      </MapLibreGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});

const chevronStyles = StyleSheet.create({
  container: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderBottomWidth: 28,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4A90D9',
  },
  glow: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(74,144,217,0.25)',
  },
});
