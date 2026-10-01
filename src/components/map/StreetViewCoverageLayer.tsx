import React, { useCallback } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { isMapillaryConfigured } from '../../services/imagery/streetViewService';
import {
  MAPILLARY_TOKEN,
  PANORAMAX_TILES_URL,
  mapillaryCoverageTileUrl,
} from '../../constants/config';
import { useStreetViewStore } from '../../stores/streetViewStore';

/**
 * Street-view coverage overlay.
 *
 * Draws where street-level imagery exists so tapping a covered road/area opens
 * the 3D street-view viewer. Panoramax (open, no token) is always drawn;
 * Mapillary coverage is added only when a token is configured, matching the
 * opt-in rule used by the 3D viewer itself.
 *
 * Only 360° coverage is advertised: the viewer can only render equirectangular
 * panoramas, and the raw provider tiles also carry flat (frame-camera) captures
 * that would show a green line yet dead-end with "no imagery" on tap. Panoramax
 * sequences/pictures are filtered to `type = 'equirectangular'` and Mapillary
 * to `is_pano = true`, so a visible trace always has something to open.
 *
 * Both sources render in a single unified colour so a street covered by either
 * provider reads as one green line rather than one line per source.
 */

const PANO_SOURCE_ID = 'streetViewCoveragePanoramax';
const PANO_SEQUENCES_LAYER = 'streetViewCoveragePanoramaxSequences';
const PANO_PICTURES_LAYER = 'streetViewCoveragePanoramaxPictures';

const MAP_SOURCE_ID = 'streetViewCoverageMapillary';
const MAP_OVERVIEW_LAYER = 'streetViewCoverageMapillaryOverview';
const MAP_SEQUENCE_LAYER = 'streetViewCoverageMapillarySequences';

/** Comfortable tap target without swallowing every nearby map tap. */
const COVERAGE_HITBOX = { width: 36, height: 36 } as const;

/** One colour for every source, so overlaps don't read as separate lines. */
const COVERAGE_COLOR = '#35AF6D';

/** Panoramax exposes the capture projection; only equirectangular is viewable. */
const PANO_PANO_FILTER = ['==', ['get', 'type'], 'equirectangular'] as any;
/** Mapillary marks sequences that contain panoramic imagery. */
const MAP_PANO_FILTER = ['==', ['get', 'is_pano'], true] as any;

const LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 2, 15, 3] as any;

export function StreetViewCoverageLayer() {
  const visible = useStreetViewStore((s) => s.streetViewLayerVisible);
  const router = useRouter();

  const openStreetView = useCallback(
    (coordinates: { latitude: number; longitude: number }) => {
      const { latitude, longitude } = coordinates;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      router.push({
        pathname: '/imagery/street-view',
        params: { lat: String(latitude), lng: String(longitude) },
      });
    },
    [router],
  );

  const handlePress = useCallback(
    (event: any) => {
      const coordinates = event?.coordinates;
      if (coordinates) openStreetView(coordinates);
    },
    [openStreetView],
  );

  if (!visible) return null;

  return (
    <>
      <MapLibreGL.VectorSource
        id={PANO_SOURCE_ID}
        tileUrlTemplates={[PANORAMAX_TILES_URL]}
        minZoomLevel={0}
        maxZoomLevel={15}
        onPress={handlePress}
        hitbox={COVERAGE_HITBOX}
      >
        <MapLibreGL.LineLayer
          id={PANO_SEQUENCES_LAYER}
          sourceLayerID="sequences"
          filter={PANO_PANO_FILTER}
          style={{
            lineColor: COVERAGE_COLOR,
            lineOpacity: 0.8,
            lineWidth: LINE_WIDTH,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <MapLibreGL.CircleLayer
          id={PANO_PICTURES_LAYER}
          sourceLayerID="pictures"
          filter={PANO_PANO_FILTER}
          minZoomLevel={14}
          style={{
            circleColor: COVERAGE_COLOR,
            circleRadius: ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 6] as any,
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 1,
          }}
        />
      </MapLibreGL.VectorSource>

      {isMapillaryConfigured() && (
        <MapLibreGL.VectorSource
          id={MAP_SOURCE_ID}
          tileUrlTemplates={[mapillaryCoverageTileUrl(MAPILLARY_TOKEN)]}
          minZoomLevel={0}
          maxZoomLevel={14}
          onPress={handlePress}
          hitbox={COVERAGE_HITBOX}
        >
          <MapLibreGL.CircleLayer
            id={MAP_OVERVIEW_LAYER}
            sourceLayerID="overview"
            filter={MAP_PANO_FILTER}
            minZoomLevel={0}
            maxZoomLevel={5}
            style={{
              circleColor: COVERAGE_COLOR,
              circleRadius: ['interpolate', ['linear'], ['zoom'], 0, 3, 5, 8] as any,
              circleOpacity: 0.7,
            }}
          />
          <MapLibreGL.LineLayer
            id={MAP_SEQUENCE_LAYER}
            sourceLayerID="sequence"
            filter={MAP_PANO_FILTER}
            minZoomLevel={6}
            maxZoomLevel={14}
            style={{
              lineColor: COVERAGE_COLOR,
              lineOpacity: 0.8,
              lineWidth: LINE_WIDTH,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </MapLibreGL.VectorSource>
      )}
    </>
  );
}
