import React, { useCallback, useMemo } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { useTransitStore } from '../../stores/transitStore';
import type { TransitRouteLine, OtpItinerary, SelectedTransitStop } from '../../models/transit';

// ── Default route colours per mode (when OSM has no colour tag) ─────

const MODE_COLORS: Record<string, string> = {
  SUBWAY: '#1A5BA5',
  RAIL: '#E3470B',
  TRAM: '#D4A017',
  FERRY: '#00A5CF',
};

function routeColor(line: TransitRouteLine): string {
  if (line.color && /^[0-9A-Fa-f]{6}$/.test(line.color)) return `#${line.color}`;
  return MODE_COLORS[line.mode] ?? '#007AFF';
}

// ── Empty GeoJSON singletons (stable references for initial state) ──

const EMPTY_LINE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};
const EMPTY_POINT_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// ── Route lines layer (always mounted, visibility toggled) ──────────

function RouteLinesLayer({ lines, visible }: { lines: TransitRouteLine[]; visible: boolean }) {
  const geoJson = useMemo(() => {
    if (lines.length === 0) return EMPTY_LINE_COLLECTION;
    const features = lines.map((line) => ({
      type: 'Feature' as const,
      properties: {
        id: line.id,
        ref: line.ref ?? '',
        name: line.name ?? '',
        color: routeColor(line),
        mode: line.mode,
      },
      geometry: {
        type: 'MultiLineString' as const,
        coordinates: line.geometry,
      },
    }));
    return { type: 'FeatureCollection' as const, features };
  }, [lines]);

  return (
    <MapLibreGL.ShapeSource id="transit-lines" shape={geoJson as any}>
      <MapLibreGL.LineLayer
        id="transit-lines-color"
        minZoomLevel={8}
        maxZoomLevel={20}
        style={{
          lineColor: ['get', 'color'] as any,
          lineWidth: [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            1,
            10,
            1.5,
            13,
            2.5,
            16,
            4,
            18,
            6,
          ] as any,
          lineCap: 'round',
          lineJoin: 'round',
          lineOpacity: 0.9,
          visibility: visible ? 'visible' : 'none',
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}

// ── Stop dots (always mounted, visibility toggled) ──────────────────

/**
 * Approximate degree-distance threshold for stop↔route association.
 * ~0.003° ≈ 300 m — if a route's geometry passes within this distance
 * of a stop, we consider that route as serving the stop.  This catches
 * cases where OSM relations are incomplete (e.g. LIRR Ronkonkoma
 * Branch doesn't list Hicksville as a member even though its tracks
 * run through the station).
 */
const PROXIMITY_DEG = 0.003;

/** Check whether any point in a route's geometry is within PROXIMITY_DEG of (lat, lon). */
function routePassesNear(line: TransitRouteLine, lat: number, lon: number): boolean {
  for (const seg of line.geometry) {
    for (const [pLon, pLat] of seg) {
      if (Math.abs(pLat - lat) < PROXIMITY_DEG && Math.abs(pLon - lon) < PROXIMITY_DEG) {
        return true;
      }
    }
  }
  return false;
}

function RouteStopsLayer({
  lines,
  visible,
  onStopPress,
}: {
  lines: TransitRouteLine[];
  visible: boolean;
  onStopPress: (stop: SelectedTransitStop) => void;
}) {
  const { geoJson, stopMap } = useMemo(() => {
    if (lines.length === 0) {
      return { geoJson: EMPTY_POINT_COLLECTION, stopMap: new Map<string, any>() };
    }

    const seen = new Map<
      string,
      {
        name: string;
        lat: number;
        lon: number;
        routes: SelectedTransitStop['routes'];
      }
    >();

    for (const line of lines) {
      for (const s of line.stops) {
        const key = `${s.name}:${(s.lat * 200).toFixed(0)},${(s.lon * 200).toFixed(0)}`;
        const existing = seen.get(key);
        if (existing) {
          if (!existing.routes.some((r) => r.ref === line.ref && r.name === line.name)) {
            existing.routes.push({
              ref: line.ref,
              name: line.name,
              color: line.color,
              mode: line.mode,
            });
          }
        } else {
          seen.set(key, {
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            routes: [{ ref: line.ref, name: line.name, color: line.color, mode: line.mode }],
          });
        }
      }
    }

    // ── Geometry-proximity enrichment ──────────────────────────────
    // For each stop, check if any route's geometry passes nearby.
    // This catches routes whose OSM relations don't list the stop as
    // a member even though their tracks physically pass through.
    for (const stop of seen.values()) {
      for (const line of lines) {
        // Already associated?
        if (stop.routes.some((r) => r.ref === line.ref && r.name === line.name)) continue;
        if (routePassesNear(line, stop.lat, stop.lon)) {
          stop.routes.push({
            ref: line.ref,
            name: line.name,
            color: line.color,
            mode: line.mode,
          });
        }
      }
    }

    const features = [...seen.entries()].map(([key, stop]) => ({
      type: 'Feature' as const,
      properties: {
        key,
        name: stop.name,
        routeCount: stop.routes.length,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [stop.lon, stop.lat],
      },
    }));

    return {
      geoJson: { type: 'FeatureCollection' as const, features },
      stopMap: seen,
    };
  }, [lines]);

  const handlePress = useCallback(
    (event: any) => {
      const feature = event?.features?.[0];
      if (!feature) return;
      const key = feature.properties?.key;
      const data = stopMap.get(key);
      if (!data) return;
      onStopPress({
        name: data.name,
        lat: data.lat,
        lon: data.lon,
        routes: data.routes,
      });
    },
    [stopMap, onStopPress],
  );

  return (
    <MapLibreGL.ShapeSource
      id="transit-route-stops"
      shape={geoJson as any}
      onPress={handlePress}
      hitbox={{ width: 20, height: 20 }}
    >
      <MapLibreGL.CircleLayer
        id="transit-route-stops-ring"
        minZoomLevel={12}
        maxZoomLevel={20}
        style={{
          circleRadius: ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5, 18, 8] as any,
          circleColor: '#FFFFFF',
          circleStrokeWidth: ['interpolate', ['linear'], ['zoom'], 12, 1.5, 15, 2.5, 18, 3] as any,
          circleStrokeColor: '#666666',
          visibility: visible ? 'visible' : 'none',
        }}
      />
      <MapLibreGL.SymbolLayer
        id="transit-route-stops-label"
        minZoomLevel={14}
        maxZoomLevel={20}
        style={{
          textField: ['get', 'name'] as any,
          textSize: ['interpolate', ['linear'], ['zoom'], 14, 10, 16, 12] as any,
          textOffset: [0, 1.3] as any,
          textAnchor: 'top',
          textColor: '#FFFFFF',
          textHaloColor: '#000000',
          textHaloWidth: 1.5,
          textMaxWidth: 10,
          textFont: ['Noto Sans Bold'] as any,
          visibility: visible ? 'visible' : 'none',
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}

// ── Itinerary route layer (for trip planning) ───────────────────────

function decodeOtpPolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function ItineraryLayer({ itinerary }: { itinerary: OtpItinerary }) {
  const lineColor = (mode: string, color?: string) => {
    if (color && /^[0-9A-Fa-f]{6}$/.test(color)) return `#${color}`;
    return MODE_COLORS[mode] ?? '#007AFF';
  };

  const geoJson = useMemo(() => {
    const features = itinerary.legs.map((leg, i) => ({
      type: 'Feature' as const,
      properties: {
        legIndex: i,
        mode: leg.mode,
        color: lineColor(leg.mode, leg.route?.color ?? undefined),
        isWalk: leg.mode === 'WALK',
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: decodeOtpPolyline(leg.legGeometry.points),
      },
    }));
    return { type: 'FeatureCollection' as const, features };
  }, [itinerary]);

  return (
    <MapLibreGL.ShapeSource id="transit-itinerary" shape={geoJson as any}>
      <MapLibreGL.LineLayer
        id="transit-itinerary-casing"
        filter={['==', ['get', 'isWalk'], false] as any}
        style={{
          lineColor: '#FFFFFF',
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 17, 10] as any,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
      <MapLibreGL.LineLayer
        id="transit-itinerary-line"
        filter={['==', ['get', 'isWalk'], false] as any}
        style={{
          lineColor: ['get', 'color'] as any,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 17, 7] as any,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
      <MapLibreGL.LineLayer
        id="transit-itinerary-walk"
        filter={['==', ['get', 'isWalk'], true] as any}
        style={{
          lineColor: '#888888',
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 17, 4] as any,
          lineDasharray: [2, 2] as any,
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </MapLibreGL.ShapeSource>
  );
}

// ── Main transit layer component ────────────────────────────────────
// Always mounted — layers toggle visibility, never unmount/remount.
// This avoids expensive GPU re-upload on every toggle.

export function TransitLayer() {
  const transitLayerVisible = useTransitStore((s) => s.transitLayerVisible);
  const routeLines = useTransitStore((s) => s.routeLines);
  const itineraries = useTransitStore((s) => s.itineraries);
  const selectedIndex = useTransitStore((s) => s.selectedItineraryIndex);
  const setSelectedStop = useTransitStore((s) => s.setSelectedStop);

  const handleStopPress = useCallback(
    (stop: SelectedTransitStop) => {
      setSelectedStop(stop);
    },
    [setSelectedStop],
  );

  const selectedItinerary = itineraries[selectedIndex] ?? null;

  return (
    <>
      <RouteLinesLayer lines={routeLines} visible={transitLayerVisible} />
      <RouteStopsLayer
        lines={routeLines}
        visible={transitLayerVisible}
        onStopPress={handleStopPress}
      />
      {selectedItinerary && <ItineraryLayer itinerary={selectedItinerary} />}
    </>
  );
}
