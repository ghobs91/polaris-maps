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
 */

const PANO_SOURCE_ID = 'streetViewCoveragePanoramax';
const PANO_SEQUENCES_LAYER = 'streetViewCoveragePanoramaxSequences';
const PANO_PICTURES_LAYER = 'streetViewCoveragePanoramaxPictures';

const MAP_SOURCE_ID = 'streetViewCoverageMapillary';
const MAP_OVERVIEW_LAYER = 'streetViewCoverageMapillaryOverview';
const MAP_SEQUENCE_LAYER = 'streetViewCoverageMapillarySequences';

/** Comfortable tap target without swallowing every nearby map tap. */
const COVERAGE_HITBOX = { width: 36, height: 36 } as const;

const PANO_COLOR = '#FF6F00';
const MAPILLARY_COLOR = '#35AF6D';

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
          style={{
            lineColor: PANO_COLOR,
            lineOpacity: 0.85,
            lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 3, 16, 4] as any,
          }}
        />
        <MapLibreGL.CircleLayer
          id={PANO_PICTURES_LAYER}
          sourceLayerID="pictures"
          minZoomLevel={14}
          style={{
            circleColor: PANO_COLOR,
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
            minZoomLevel={0}
            maxZoomLevel={5}
            style={{
              circleColor: MAPILLARY_COLOR,
              circleRadius: ['interpolate', ['linear'], ['zoom'], 0, 3, 5, 8] as any,
              circleOpacity: 0.7,
            }}
          />
          <MapLibreGL.LineLayer
            id={MAP_SEQUENCE_LAYER}
            sourceLayerID="sequence"
            minZoomLevel={6}
            maxZoomLevel={14}
            style={{
              lineColor: MAPILLARY_COLOR,
              lineOpacity: 0.85,
              lineWidth: ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 3, 14, 4] as any,
            }}
          />
        </MapLibreGL.VectorSource>
      )}
    </>
  );
}
