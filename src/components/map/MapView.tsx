import React, { useRef, useCallback, useEffect } from 'react';
import MapLibreGL, { Logger } from '@maplibre/maplibre-react-native';
import { StyleSheet, View, Dimensions } from 'react-native';
import { useMapStore } from '../../stores/mapStore';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { fetchOsmPois, fetchNominatimPois } from '../../services/poi/osmFetcher';
import { getPlacesInBounds } from '../../services/poi/poiService';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';
import { OPENFREEMAP_STYLE_URL } from '../../constants/config';
import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { colors } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { TrafficOverlay } from './TrafficOverlay';
import { TrafficRouteLayer } from './TrafficRouteLayer';
import { POILayer } from './POILayer';
import type { OsmPoi } from '../../services/poi/osmFetcher';

// Suppress noisy MapLibre Native font-loading timeouts (e.g. missing glyph
// ranges on OpenFreeMap's CDN). These are non-fatal — the map still renders.
Logger.setLogCallback((log) => {
  if (log.message.includes('Failed to load glyph range')) return true;
  if (log.message.includes('/fonts/') && log.message.includes('timed out')) return true;
  return false;
});

const POI_MIN_ZOOM = 14;
/** Debounce for the POI fetch (Overpass is cached, so repeat visits are instant). */
const OSM_FETCH_DEBOUNCE_MS = 300;

/** ~30 m threshold for considering two POIs as duplicates. */
const DEDUP_THRESHOLD_DEG = 0.0003;

/**
 * Deduplicate POIs that are very close together and share similar names.
 * Earlier entries in the array take priority (Overture before OSM).
 */
function deduplicatePois(pois: OsmPoi[]): OsmPoi[] {
  const result: OsmPoi[] = [];
  for (const poi of pois) {
    const isDup = result.some(
      (existing) =>
        Math.abs(existing.lat - poi.lat) < DEDUP_THRESHOLD_DEG &&
        Math.abs(existing.lng - poi.lng) < DEDUP_THRESHOLD_DEG &&
        existing.name.toLowerCase() === poi.name.toLowerCase(),
    );
    if (!isDup) result.push(poi);
  }
  return result;
}

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

  // In navigation mode, follow navPosition with tilt + heading.
  // paddingTop shifts the focal point downward in screen space so the marker
  // sits in the lower third, showing more of the route ahead (Apple/Google Maps style).
  useEffect(() => {
    if (!navigationMode || !navPosition || !cameraRef.current) return;
    const screenHeight = Dimensions.get('window').height;
    cameraRef.current.setCamera({
      centerCoordinate: navPosition,
      zoomLevel: 17,
      heading: navBearing,
      pitch: 55,
      padding: {
        paddingTop: screenHeight * 0.4,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      },
      animationDuration: 800,
      animationMode: 'flyTo',
    });
  }, [navigationMode, navPosition, navBearing]);

  // Listen for programmatic viewport changes (locate, search select) and fly to them
  useEffect(() => {
    const unsub = useMapStore.subscribe((state, prev) => {
      if (!cameraRef.current) return;

      // Handle fitBounds requests (route overview zoom).
      // Use asymmetric padding so the route appears fully above the directions
      // panel that covers the bottom ~60% of the screen.
      if (state.fitBounds && state.fitBounds !== prev.fitBounds) {
        const [minLng, minLat, maxLng, maxLat] = state.fitBounds;
        const sh = Dimensions.get('window').height;
        cameraRef.current.fitBounds(
          [maxLng, maxLat], // NE
          [minLng, minLat], // SW
          { paddingTop: 80, paddingBottom: sh * 0.62, paddingLeft: 60, paddingRight: 60 },
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

  const handleRegionDidChange = useCallback(
    (event: any) => {
      // Don't fetch POIs while actively navigating — camera moves constantly and
      // POI annotations would fight the nav UI.
      if (navigationMode) return;

      const zoom: number = event?.properties?.zoomLevel ?? 0;
      const rawBounds: [[number, number], [number, number]] | undefined =
        event?.properties?.visibleBounds;

      // Always update bounds so POILayer and category search always have them,
      // even when zoomed out below the fetch threshold.
      if (rawBounds) {
        const [[maxLng, maxLat], [minLng, minLat]] = rawBounds;
        useOsmPoiStore.getState().setZoomAndBounds(zoom, { minLat, minLng, maxLat, maxLng });
      }

      if (zoom < POI_MIN_ZOOM) {
        // Clear POIs when zoomed out (but keep category search results)
        const { categorySearchResults } = useOsmPoiStore.getState();
        if (!categorySearchResults) {
          useOsmPoiStore.getState().setPois([]);
        }
        return;
      }
      if (!rawBounds) return;
      const [[maxLng, maxLat], [minLng, minLat]] = rawBounds;

      // If a category search is active, show those results instead of the
      // default POI fetch. The category search already ran against the viewport
      // at search time — we don't re-fetch on every pan because the results
      // are bounded to the region the user was viewing when they searched.
      const { categorySearchResults } = useOsmPoiStore.getState();
      if (categorySearchResults) {
        useOsmPoiStore.getState().setPois(categorySearchResults);
        return;
      }

      // Debounce the combined fetch — Overpass is cached for repeat viewports, so
      // this is fast for areas the user has already visited. A single setPois call
      // avoids the double annotation teardown that triggers the MapLibre
      // "Unknown annotation found nearby tap" fault.
      if (poiFetchTimer.current) clearTimeout(poiFetchTimer.current);
      poiFetchTimer.current = setTimeout(async () => {
        try {
          useOsmPoiStore.getState().setIsLoading(true);

          // Try Overpass + local Overture in parallel
          const [osmPois, cachedPlaces] = await Promise.all([
            fetchOsmPois(minLat, minLng, maxLat, maxLng).catch(() => [] as OsmPoi[]),
            getPlacesInBounds(minLat, minLng, maxLat, maxLng).catch(() => []),
          ]);

          const overturePois = cachedPlaces.map(placeToOsmPoi);
          let merged = deduplicatePois([...overturePois, ...osmPois]);

          // If both Overpass and local DB returned nothing, try Nominatim
          if (merged.length === 0) {
            const nominatimPois = await fetchNominatimPois(minLat, minLng, maxLat, maxLng).catch(
              () => [],
            );
            merged = nominatimPois;
          }

          useOsmPoiStore.getState().setPois(merged);
        } catch {
          // Silently ignore — data sources may be unavailable
        } finally {
          useOsmPoiStore.getState().setIsLoading(false);
        }
      }, OSM_FETCH_DEBOUNCE_MS);
    },
    [navigationMode],
  );

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
        mapStyle={isDark ? DARK_MAP_STYLE_JSON : OPENFREEMAP_STYLE_URL}
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

        {/* Navigation marker — frosted-glass red triangle */}
        {navigationMode && navPosition && (
          <MapLibreGL.PointAnnotation
            id="navChevron"
            coordinate={navPosition}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <NavPuck />
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

/**
 * Red frosted-glass triangle nav marker, pointing UP (direction of travel).
 * Uses layered CSS-border triangles to simulate a glossy, translucent look.
 */
function NavPuck() {
  return (
    <View style={puckStyles.wrapper}>
      {/* Diffuse outer glow halo */}
      <View style={puckStyles.glow} />
      {/* Main body — deep semi-transparent red */}
      <View style={puckStyles.body} />
      {/* Inner dark layer for depth (lower two-thirds) */}
      <View style={puckStyles.shadow} />
      {/* Gloss highlight near the tip */}
      <View style={puckStyles.gloss} />
    </View>
  );
}

// Triangle dimensions
const TW = 21; // half-base width of the body triangle
const TH = 33; // height of the body triangle
const PAD = 5; // padding around the body for the glow halo
// Derived positions (all triangles share the same tip x-center)
const GLOSS_BW = Math.round(TW * 0.38); // 11
const GLOSS_BH = Math.round(TH * 0.44); // 19
const GLOSS_L = PAD + TW - GLOSS_BW; // 23  — keeps gloss tip x == body tip x
const GLOSS_BOT = Math.round(TH * 0.52); // 23  — bottom offset inside wrapper
const SHADOW_BW = Math.round(TW * 0.8); // 22
const SHADOW_BH = Math.round(TH * 0.65); // 29
const SHADOW_L = PAD + TW - SHADOW_BW; // 6   — also centered with body
const SHADOW_BOT = 0;

const puckStyles = StyleSheet.create({
  wrapper: {
    width: (TW + PAD) * 2, // 68
    height: TH + PAD, // 50
    // Drop shadow for depth
    shadowColor: '#7f1d1d',
    shadowOpacity: 0.72,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 14,
  },
  // Slightly oversized dim halo behind the body
  glow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    borderLeftWidth: TW + PAD,
    borderRightWidth: TW + PAD,
    borderBottomWidth: TH + PAD,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(220, 40, 40, 0.22)',
  },
  // Main triangle — ▲ pointing UP (borderBottomWidth = tip at top)
  body: {
    position: 'absolute',
    bottom: 0,
    left: PAD,
    width: 0,
    height: 0,
    borderLeftWidth: TW,
    borderRightWidth: TW,
    borderBottomWidth: TH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(196, 24, 24, 0.92)',
  },
  // Darker overlay on the lower portion to add depth/candy-glass look
  shadow: {
    position: 'absolute',
    bottom: SHADOW_BOT,
    left: SHADOW_L,
    width: 0,
    height: 0,
    borderLeftWidth: SHADOW_BW,
    borderRightWidth: SHADOW_BW,
    borderBottomWidth: SHADOW_BH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(80, 0, 0, 0.28)',
  },
  // Bright gloss highlight pinned near the tip
  gloss: {
    position: 'absolute',
    bottom: GLOSS_BOT,
    left: GLOSS_L,
    width: 0,
    height: 0,
    borderLeftWidth: GLOSS_BW,
    borderRightWidth: GLOSS_BW,
    borderBottomWidth: GLOSS_BH,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(255, 190, 185, 0.32)',
  },
});
