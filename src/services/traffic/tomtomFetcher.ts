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
