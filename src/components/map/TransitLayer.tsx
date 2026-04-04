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

const ROUTE_LINE_WIDTH = [
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
] as any;
const ROUTE_LINE_COLOR = ['get', 'color'] as any;

const ROUTE_LINE_STYLE_VISIBLE = {
  lineColor: ROUTE_LINE_COLOR,
  lineWidth: ROUTE_LINE_WIDTH,
  lineCap: 'round' as const,
  lineJoin: 'round' as const,
  lineOpacity: 0.9,
  visibility: 'visible' as const,
};
const ROUTE_LINE_STYLE_HIDDEN = {
  ...ROUTE_LINE_STYLE_VISIBLE,
  visibility: 'none' as const,
};

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
        style={visible ? ROUTE_LINE_STYLE_VISIBLE : ROUTE_LINE_STYLE_HIDDEN}
      />
    </MapLibreGL.ShapeSource>
  );
}

// ── Stop dots (always mounted, visibility toggled) ──────────────────

const STOP_CIRCLE_RADIUS = ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 5, 18, 8] as any;
const STOP_CIRCLE_STROKE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  12,
  1.5,
  15,
  2.5,
  18,
  3,
] as any;

const STOP_CIRCLE_STYLE_VISIBLE = {
  circleRadius: STOP_CIRCLE_RADIUS,
  circleColor: '#FFFFFF',
  circleStrokeWidth: STOP_CIRCLE_STROKE_WIDTH,
  circleStrokeColor: '#666666',
  visibility: 'visible' as const,
};
const STOP_CIRCLE_STYLE_HIDDEN = {
  ...STOP_CIRCLE_STYLE_VISIBLE,
  visibility: 'none' as const,
};

const STOP_LABEL_TEXT_SIZE = ['interpolate', ['linear'], ['zoom'], 14, 10, 16, 12] as any;
const STOP_LABEL_TEXT_FIELD = ['get', 'name'] as any;
const STOP_LABEL_TEXT_OFFSET = [0, 1.3] as any;
const STOP_LABEL_TEXT_FONT = ['Noto Sans Bold'] as any;

const STOP_LABEL_STYLE_VISIBLE = {
  textField: STOP_LABEL_TEXT_FIELD,
  textSize: STOP_LABEL_TEXT_SIZE,
  textOffset: STOP_LABEL_TEXT_OFFSET,
  textAnchor: 'top' as const,
  textColor: '#FFFFFF',
  textHaloColor: '#000000',
  textHaloWidth: 1.5,
  textMaxWidth: 10,
  textFont: STOP_LABEL_TEXT_FONT,
  visibility: 'visible' as const,
};
const STOP_LABEL_STYLE_HIDDEN = {
  ...STOP_LABEL_STYLE_VISIBLE,
  visibility: 'none' as const,
};

/**
 * Approximate degree-distance threshold for stop↔route association.
 * ~0.003° ≈ 300 m — if a route's geometry passes within this distance
 * of a stop, we consider that route as serving the stop.  This catches
 * cases where OSM relations are incomplete (e.g. LIRR Ronkonkoma
 * Branch doesn't list Hicksville as a member even though its tracks
 * run through the station).
 */
const PROXIMITY_DEG = 0.003;

// ── Spatial grid index for fast geometry-proximity lookups ──────────
// Buckets route geometry points into ~1 km cells so stop↔route
// association avoids the previous O(stops × lines × points) brute-force.
const GRID_SIZE = 0.01; // ~1 km per grid cell

interface RouteGridIndex {
  /** Map from "gridRow,gridCol" → Set of line indices */
  grid: Map<string, Set<number>>;
}

function buildRouteGrid(lines: TransitRouteLine[]): RouteGridIndex {
  const grid = new Map<string, Set<number>>();
  for (let li = 0; li < lines.length; li++) {
    for (const seg of lines[li].geometry) {
      for (const [pLon, pLat] of seg) {
        const key = `${Math.floor(pLat / GRID_SIZE)},${Math.floor(pLon / GRID_SIZE)}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = new Set<number>();
          grid.set(key, bucket);
        }
        bucket.add(li);
      }
    }
  }
  return { grid };
}

/** Return indices of lines whose geometry passes near (lat, lon). */
function getNearbyLineIndices(index: RouteGridIndex, lat: number, lon: number): Set<number> {
  const result = new Set<number>();
  const r = Math.ceil(PROXIMITY_DEG / GRID_SIZE);
  const baseLat = Math.floor(lat / GRID_SIZE);
  const baseLon = Math.floor(lon / GRID_SIZE);
  for (let i = -r; i <= r; i++) {
    for (let j = -r; j <= r; j++) {
      const bucket = index.grid.get(`${baseLat + i},${baseLon + j}`);
      if (bucket) {
        for (const li of bucket) result.add(li);
      }
    }
  }
  return result;
}

/** Fine-grained check: does any point in line's geometry fall within PROXIMITY_DEG? */
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
        routeSet: Set<string>;
      }
    >();

    for (const line of lines) {
      for (const s of line.stops) {
        const key = `${s.name}:${(s.lat * 200).toFixed(0)},${(s.lon * 200).toFixed(0)}`;
        let existing = seen.get(key);
        if (!existing) {
          existing = {
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            routes: [],
            routeSet: new Set<string>(),
          };
          seen.set(key, existing);
        }
        const routeKey = `${line.ref}\0${line.name}`;
        if (!existing.routeSet.has(routeKey)) {
          existing.routeSet.add(routeKey);
          existing.routes.push({
            ref: line.ref,
            name: line.name,
            color: line.color,
            mode: line.mode,
          });
        }
      }
    }

    // ── Geometry-proximity enrichment (spatial-indexed) ─────────────
    // For each stop, check only lines whose geometry passes nearby
    // using the grid index, then confirm with fine-grained check.
    const grid = buildRouteGrid(lines);
    for (const stop of seen.values()) {
      const candidateIndices = getNearbyLineIndices(grid, stop.lat, stop.lon);
      for (const li of candidateIndices) {
        const line = lines[li];
        const routeKey = `${line.ref}\0${line.name}`;
        if (stop.routeSet.has(routeKey)) continue;
        if (routePassesNear(line, stop.lat, stop.lon)) {
          stop.routeSet.add(routeKey);
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
        style={visible ? STOP_CIRCLE_STYLE_VISIBLE : STOP_CIRCLE_STYLE_HIDDEN}
      />
      <MapLibreGL.SymbolLayer
        id="transit-route-stops-label"
        minZoomLevel={14}
        maxZoomLevel={20}
        style={visible ? STOP_LABEL_STYLE_VISIBLE : STOP_LABEL_STYLE_HIDDEN}
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
