import React, {
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import MapLibreGL, { Logger } from '@maplibre/maplibre-react-native';
import { StyleSheet, View, Dimensions } from 'react-native';
import { useMapStore } from '../../stores/mapStore';
import { useOsmPoiStore } from '../../stores/osmPoiStore';
import { fetchOsmPois, fetchNominatimPois } from '../../services/poi/osmFetcher';
import { getPlacesInBounds } from '../../services/poi/poiService';
import { fetchOverturePlaces } from '../../services/poi/overtureFetcher';
import { placeToOsmPoi } from '../../utils/placeToOsmPoi';
import { OPENFREEMAP_STYLE_URL } from '../../constants/config';
import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../constants/satelliteStyle';
import { colors } from '../../constants/theme';
import { useTheme } from '../../contexts/ThemeContext';
import { TrafficOverlay } from './TrafficOverlay';
import { TrafficRouteLayer } from './TrafficRouteLayer';
import { TransitLayer } from './TransitLayer';
import { POILayer } from './POILayer';
import type { OsmPoi } from '../../services/poi/osmFetcher';

// Suppress noisy MapLibre Native font-loading timeouts (e.g. missing glyph
// ranges on OpenFreeMap's CDN). These are non-fatal — the map still renders.
Logger.setLogCallback((log) => {
  if (log.message.includes('Failed to load glyph range')) return true;
  if (log.message.includes('/fonts/') && log.message.includes('timed out')) return true;
  return false;
});

// POIs appear from zoom 14+ to provide denser coverage at neighbourhood level.
// Below this the viewport covers too large an area to fetch meaningfully and
// the pill badges would be too sparse/cluttered to be useful.
const POI_MIN_ZOOM = 14;
/** Debounce for the POI fetch (Overpass is cached, so repeat visits are instant). */
const OSM_FETCH_DEBOUNCE_MS = 300;

/** ~30 m threshold for considering two POIs as duplicates. */
const DEDUP_THRESHOLD_DEG = 0.0003;

/**
 * Deduplicate POIs that are very close together and share similar names.
 * Earlier entries in the array take priority (Overture before OSM).
 *
 * Uses a spatial grid (cell size = DEDUP_THRESHOLD_DEG) so the average
 * complexity is O(n) instead of the previous O(n²) linear scan.
 */
function deduplicatePois(pois: OsmPoi[]): OsmPoi[] {
  const CELL = DEDUP_THRESHOLD_DEG;
  const grid = new Map<number, OsmPoi[]>();
  const result: OsmPoi[] = [];

  // Cantor-style pairing function — avoids string key allocation
  const pairKey = (a: number, b: number): number => {
    const ua = a >= 0 ? 2 * a : -2 * a - 1;
    const ub = b >= 0 ? 2 * b : -2 * b - 1;
    return ((ua + ub) * (ua + ub + 1)) / 2 + ub;
  };

  for (const poi of pois) {
    const cx = Math.floor(poi.lat / CELL);
    const cy = Math.floor(poi.lng / CELL);
    const nameLower = poi.name.toLowerCase();
    let isDup = false;

    // Check 3×3 neighbourhood
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(pairKey(cx + dx, cy + dy));
        if (!cell) continue;
        for (const existing of cell) {
          if (
            Math.abs(existing.lat - poi.lat) < DEDUP_THRESHOLD_DEG &&
            Math.abs(existing.lng - poi.lng) < DEDUP_THRESHOLD_DEG &&
            existing.name.toLowerCase() === nameLower
          ) {
            isDup = true;
            break outer;
          }
        }
      }
    }

    if (!isDup) {
      const k = pairKey(cx, cy);
      const cell = grid.get(k);
      if (cell) cell.push(poi);
      else grid.set(k, [poi]);
      result.push(poi);
    }
  }
  return result;
}

export interface MapViewHandle {
  flyTo: (lat: number, lng: number, zoom: number, bottomPadding?: number) => void;
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

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { routeGeometry, onMapPress, navigationMode, navPosition, navBearing = 0 },
  ref,
) {
  const mapRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    flyTo(lat: number, lng: number, zoom: number, bottomPadding = 0) {
      if (!cameraRef.current) return;
      cameraRef.current.setCamera({
        centerCoordinate: [lng, lat],
        zoomLevel: zoom,
        animationDuration: 500,
        animationMode: 'flyTo',
        ...(bottomPadding > 0 && {
          padding: { paddingTop: 0, paddingBottom: bottomPadding, paddingLeft: 0, paddingRight: 0 },
        }),
      });
    },
  }));
  const { isDark } = useTheme();
  const viewport = useMapStore((s) => s.viewport);
  const mapStylePref = useMapStore((s) => s.mapStyle);
  const selectedLocation = useMapStore((s) => s.selectedLocation);
  // Track the last programmatic viewport change to fly to
  const lastProgrammaticMove = useRef(0);
  // Debounce timer for OSM POI fetching
  const poiFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Abort controller to cancel stale in-flight fetches when viewport changes
  const abortRef = useRef<AbortController | null>(null);
  // Track last fetched bounds to skip re-fetch for small pans (~1 km threshold)
  const lastFetchBounds = useRef<{
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null>(null);
  // Prevent redundant POI clears during a single zoom gesture
  const zoomClearedRef = useRef(false);

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

      // locateTo always forces a fly (e.g. repeated taps after panning)
      if (state.locateTrigger !== prev.locateTrigger) {
        const v = state.viewport;
        lastProgrammaticMove.current = Date.now();
        cameraRef.current.setCamera({
          centerCoordinate: [v.lng, v.lat],
          zoomLevel: v.zoom,
          heading: v.bearing,
          pitch: v.pitch,
          animationDuration: 500,
          animationMode: 'flyTo',
        });
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

  // Clear stale POI pills as soon as zoom changes significantly. Without this,
  // the old fixed-pixel pills converge and visually overlap during the animation
  // since onRegionDidChange only fires when the gesture fully settles.
  const handleRegionIsChanging = useCallback(
    (event: any) => {
      if (navigationMode || zoomClearedRef.current) return;
      const zoom: number = event?.properties?.zoomLevel ?? 0;
      const { currentZoom, categorySearchResults } = useOsmPoiStore.getState();
      if (!categorySearchResults && Math.abs(zoom - currentZoom) >= 1) {
        useOsmPoiStore.getState().setPois([]);
        zoomClearedRef.current = true;
      }
    },
    [navigationMode],
  );

  const handleRegionDidChange = useCallback(
    (event: any) => {
      // Reset the zoom-clear guard so the next gesture can clear again.
      zoomClearedRef.current = false;

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
      //
      // Skip re-fetch if the viewport hasn't shifted more than ~1 km from the
      // last successful fetch — eliminates redundant requests on small pans.
      const POI_FETCH_THRESHOLD = 0.01; // ~1.1 km
      const lastB = lastFetchBounds.current;
      if (
        lastB &&
        Math.abs(minLat - lastB.minLat) < POI_FETCH_THRESHOLD &&
        Math.abs(maxLat - lastB.maxLat) < POI_FETCH_THRESHOLD &&
        Math.abs(minLng - lastB.minLng) < POI_FETCH_THRESHOLD &&
        Math.abs(maxLng - lastB.maxLng) < POI_FETCH_THRESHOLD
      ) {
        return;
      }

      if (poiFetchTimer.current) clearTimeout(poiFetchTimer.current);
      // Cancel any in-flight fetch from a previous viewport — its results are
      // stale and would overwrite the data we're about to request.
      if (abortRef.current) abortRef.current.abort();

      poiFetchTimer.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          useOsmPoiStore.getState().setIsLoading(true);
          lastFetchBounds.current = { minLat, minLng, maxLat, maxLng };

          // Phase 1: Instant local results — SQLite cached Overture places.
          // Show these immediately so the map feels responsive even when the
          // network is slow.
          const cachedPlaces = await getPlacesInBounds(minLat, minLng, maxLat, maxLng, 500).catch(
            () => [],
          );
          if (controller.signal.aborted) return;

          const cachedOverturePois = cachedPlaces.map(placeToOsmPoi);
          if (cachedOverturePois.length > 0) {
            useOsmPoiStore.getState().setPois(cachedOverturePois);
          }

          // Phase 2: Parallel network fetches — OSM Overpass + online Overture.
          // Skip online Overture if the local cache already has ≥ 20 results
          // (the area has been visited before — no need to re-fetch).
          const skipOnlineOverture = cachedPlaces.length >= 20;
          const [osmPois, onlineOverture] = await Promise.all([
            fetchOsmPois(minLat, minLng, maxLat, maxLng).catch(() => [] as OsmPoi[]),
            skipOnlineOverture
              ? ([] as OsmPoi[])
              : fetchOverturePlaces(minLat, minLng, maxLat, maxLng, 500)
                  .then((places) => places.map(placeToOsmPoi))
                  .catch(() => [] as OsmPoi[]),
          ]);
          if (controller.signal.aborted) return;

          let merged = deduplicatePois([...cachedOverturePois, ...onlineOverture, ...osmPois]);

          // If both Overpass and local DB returned nothing, try Nominatim
          if (merged.length === 0) {
            const nominatimPois = await fetchNominatimPois(minLat, minLng, maxLat, maxLng).catch(
              () => [],
            );
            if (controller.signal.aborted) return;
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

  // Resolve the map style based on user preference and dark mode
  const resolvedMapStyle = useMemo(
    () =>
      mapStylePref === 'satellite'
        ? SATELLITE_STYLE_JSON
        : isDark
          ? DARK_MAP_STYLE_JSON
          : OPENFREEMAP_STYLE_URL,
    [mapStylePref, isDark],
  );

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={resolvedMapStyle}
        onPress={handlePress}
        onRegionIsChanging={handleRegionIsChanging}
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

        {/* Navigation marker — Apple Maps-style oval puck with solid arrow */}
        {navigationMode && navPosition && (
          <MapLibreGL.PointAnnotation
            id="navChevron"
            coordinate={navPosition}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <NavPuck isDark={isDark} />
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

        <TransitLayer />

        <POILayer />
      </MapLibreGL.MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});

/**
 * Apple Maps-style nav puck: oval circle background with a solid blue arrow.
 * Background colour adapts to light/dark mode.
 */
function NavPuck({ isDark: dark }: { isDark: boolean }) {
  return (
    <View style={[puckStyles.oval, dark ? puckStyles.ovalDark : puckStyles.ovalLight]}>
      {/* Up-pointing solid arrow via CSS border trick */}
      <View style={puckStyles.arrow} />
    </View>
  );
}

const ARROW_HALF = 11; // half of arrow base width
const ARROW_H = 18; // arrow height

const puckStyles = StyleSheet.create({
  oval: {
    width: 56,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  ovalLight: {
    backgroundColor: '#FFFFFF',
  },
  ovalDark: {
    backgroundColor: '#2C2C2E',
  },
  // ▲ pointing UP — the CSS-border triangle trick
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_HALF,
    borderRightWidth: ARROW_HALF,
    borderBottomWidth: ARROW_H,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#007AFF',
    // Visual centroid of a triangle is at 1/3 height from base;
    // nudge up slightly so arrow looks centered in the oval.
    marginBottom: Math.round(ARROW_H / 5),
  },
});
