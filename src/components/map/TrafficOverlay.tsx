import React from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useTrafficStore } from '../../stores/trafficStore';
import { colors } from '../../constants/theme';
import type { CongestionLevel } from '../../models/traffic';

const CONGESTION_COLORS: Record<CongestionLevel, string> = {
  free_flow: colors.trafficFreeFlow,
  slow: colors.trafficSlow,
  congested: colors.trafficCongested,
  stopped: colors.trafficStopped,
};

export function TrafficOverlay() {
  const segmentTraffic = useTrafficStore((s) => s.segmentTraffic);
  const segments = Object.values(segmentTraffic);

  if (segments.length === 0) return null;

  // Build GeoJSON features from traffic state
  // In production, this would map segment IDs to actual road geometries
  // For now, render point markers at congested segments
  const features: GeoJSON.Feature[] = segments.map((seg) => ({
    type: 'Feature',
    properties: {
      congestionLevel: seg.congestionLevel,
      color: CONGESTION_COLORS[seg.congestionLevel],
      speedKmh: seg.avgSpeedKmh,
    },
    geometry: {
      type: 'Point',
      coordinates: [0, 0], // Would be resolved from segment geometry
    },
  }));

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  return (
    <MapLibreGL.ShapeSource id="traffic-overlay" shape={geojson}>
      <MapLibreGL.CircleLayer
        id="traffic-circles"
        style={{
          circleRadius: 4,
          circleColor: ['get', 'color'],
          circleOpacity: 0.8,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}
