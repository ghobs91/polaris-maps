import type { NormalizedTrafficSegment } from '../../models/traffic';
import { tomtomApiKey, TOMTOM_FLOW_BASE_URL } from '../../constants/config';

export interface TomTomFlowResponse {
  flowSegmentData: {
    frc: string;
    currentSpeed: number;
    freeFlowSpeed: number;
    currentTravelTime: number;
    freeFlowTravelTime: number;
    confidence: number;
    coordinates: {
      coordinate: Array<{ latitude: number; longitude: number }>;
    };
  };
}

/** Hash two coordinates to produce a stable segment ID suffix. */
function hashCoords(
  first: { latitude: number; longitude: number },
  last: { latitude: number; longitude: number },
): string {
  const raw = `${first.latitude.toFixed(5)},${first.longitude.toFixed(5)}-${last.latitude.toFixed(5)},${last.longitude.toFixed(5)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Normalize a single TomTom response into our shared format. Returns null if invalid. */
export function normalizeTomTomResponse(
  response: TomTomFlowResponse,
): NormalizedTrafficSegment | null {
  const data = response.flowSegmentData;
  if (!data || data.freeFlowSpeed <= 0) return null;

  const coords = data.coordinates?.coordinate;
  if (!coords || coords.length < 2) return null;

  const ratio = data.currentSpeed / data.freeFlowSpeed;

  return {
    id: `tomtom:${hashCoords(coords[0], coords[coords.length - 1])}`,
    coordinates: coords.map((c) => [c.longitude, c.latitude] as [number, number]),
    currentSpeedMph: data.currentSpeed,
    freeFlowSpeedMph: data.freeFlowSpeed,
    congestionRatio: Math.min(1, Math.max(0, ratio)),
    confidence: data.confidence ?? 0.9,
    source: 'tomtom',
    timestamp: Math.floor(Date.now() / 1000),
  };
}

/**
 * Determine the grid size (rows × cols) for TomTom point sampling based on zoom.
 * - zoom ≤ 12: 3×3 (9 points)
 * - zoom 13-15: 4×4 (16 points)
 * - zoom ≥ 16: 5×5 (25 points)
 */
function gridSizeForZoom(zoom: number): number {
  if (zoom <= 12) return 3;
  if (zoom >= 16) return 5;
  return 4;
}

/** Generate a grid of sample points within a bounding box. */
function sampleGrid(
  west: number,
  south: number,
  east: number,
  north: number,
  gridSize: number,
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  const latStep = (north - south) / (gridSize + 1);
  const lngStep = (east - west) / (gridSize + 1);

  for (let row = 1; row <= gridSize; row++) {
    for (let col = 1; col <= gridSize; col++) {
      points.push({
        lat: south + latStep * row,
        lng: west + lngStep * col,
      });
    }
  }
  return points;
}

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

/**
 * Fetch traffic data from TomTom for the given viewport.
 * Samples a grid of points and fetches each in parallel.
 * Returns normalized segments, silently dropping failed requests.
 */
export async function fetchTomTomTraffic(
  viewport: ViewportBounds,
): Promise<NormalizedTrafficSegment[]> {
  if (!tomtomApiKey) return [];

  const gridSize = gridSizeForZoom(viewport.zoom);
  const points = sampleGrid(viewport.west, viewport.south, viewport.east, viewport.north, gridSize);
  const zoom = Math.round(Math.min(22, Math.max(0, viewport.zoom)));

  const promises = points.map(async (pt) => {
    const url = `${TOMTOM_FLOW_BASE_URL}/${zoom}/${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}.json?key=${encodeURIComponent(tomtomApiKey)}&unit=MPH&thickness=1`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json: TomTomFlowResponse = await res.json();
      return normalizeTomTomResponse(json);
    } catch {
      return null;
    }
  });

  const results = await Promise.allSettled(promises);
  const segments: NormalizedTrafficSegment[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      segments.push(r.value);
    }
  }

  // Deduplicate by segment ID (same road can be returned for nearby grid points)
  const seen = new Set<string>();
  return segments.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/**
 * Minimum distance (degrees) between successive sample points along the route.
 * ~0.008° ≈ 800 m at mid-latitudes — avoids redundant API hits on dense polylines.
 */
const ROUTE_SAMPLE_SPACING_DEG = 0.008;

/** Max concurrent TomTom requests per batch to avoid rate-limiting. */
const ROUTE_BATCH_SIZE = 10;

/**
 * Sample evenly-spaced points along a decoded route polyline.
 * Returns points that are at least {@link ROUTE_SAMPLE_SPACING_DEG} apart.
 */
export function sampleRoutePoints(coords: [number, number][]): Array<{ lat: number; lng: number }> {
  if (coords.length === 0) return [];
  const points: Array<{ lat: number; lng: number }> = [{ lng: coords[0][0], lat: coords[0][1] }];
  let lastLng = coords[0][0];
  let lastLat = coords[0][1];

  for (let i = 1; i < coords.length; i++) {
    const dlng = coords[i][0] - lastLng;
    const dlat = coords[i][1] - lastLat;
    if (dlng * dlng + dlat * dlat >= ROUTE_SAMPLE_SPACING_DEG * ROUTE_SAMPLE_SPACING_DEG) {
      points.push({ lng: coords[i][0], lat: coords[i][1] });
      lastLng = coords[i][0];
      lastLat = coords[i][1];
    }
  }

  // Always include the last coordinate
  const last = coords[coords.length - 1];
  if (last[0] !== lastLng || last[1] !== lastLat) {
    points.push({ lng: last[0], lat: last[1] });
  }

  return points;
}

/**
 * Fetch traffic data from TomTom for points along a route polyline.
 * Unlike {@link fetchTomTomTraffic} which samples a viewport grid, this
 * samples the actual route geometry so returned segments align with the path.
 */
export async function fetchTomTomRouteTraffic(
  routeCoords: [number, number][],
): Promise<NormalizedTrafficSegment[]> {
  if (!tomtomApiKey) return [];

  const points = sampleRoutePoints(routeCoords);
  if (points.length === 0) return [];

  const segments: NormalizedTrafficSegment[] = [];
  const seen = new Set<string>();

  // Fetch in batches to avoid rate-limiting
  for (let b = 0; b < points.length; b += ROUTE_BATCH_SIZE) {
    const batch = points.slice(b, b + ROUTE_BATCH_SIZE);
    const promises = batch.map(async (pt) => {
      const url = `${TOMTOM_FLOW_BASE_URL}/14/${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}.json?key=${encodeURIComponent(tomtomApiKey)}&unit=MPH&thickness=1`;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const json: TomTomFlowResponse = await res.json();
        const seg = normalizeTomTomResponse(json);
        if (seg) {
          // Inject the query point into the segment's coordinates so the
          // route-matching algorithm always has a coordinate on the route
          // itself — TomTom's own geometry may be offset or sparse.
          seg.coordinates.push([pt.lng, pt.lat]);
        }
        return seg;
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && !seen.has(r.value.id)) {
        seen.add(r.value.id);
        segments.push(r.value);
      }
    }
  }

  return segments;
}
