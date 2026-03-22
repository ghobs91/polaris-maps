import { tomtomApiKey, TOMTOM_FLOW_BASE_URL } from '../../constants/config';
import { decodePolyline } from '../../utils/polyline';

/** Maximum number of TomTom flow API calls when coloring a route. */
const MAX_SAMPLES = 25;
/** Zoom level for TomTom Flow Segment Data requests (road-level granularity). */
const ZOOM_LEVEL = 15;

/** Map a congestion ratio (0–1) to a traffic color. */
export function congestionColor(ratio: number): string {
  if (ratio >= 0.75) return '#00C853'; // green — free flow
  if (ratio >= 0.5) return '#FFD600'; // yellow — slow
  if (ratio >= 0.25) return '#FF6D00'; // orange — congested
  return '#D50000'; // dark red — stopped / heavy delay
}

/**
 * Fetch TomTom traffic flow for evenly-spaced points along a route polyline
 * and return a GeoJSON FeatureCollection of color-coded line segments.
 *
 * Each Feature is a LineString covering one chunk of the route with a `color`
 * property set according to the current congestion ratio at that segment.
 *
 * Returns null when no API key is available or the geometry is invalid.
 */
export async function fetchRouteTrafficGeoJSON(geometry: string): Promise<{
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { color: string };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
} | null> {
  if (!tomtomApiKey) return null;

  const coords = decodePolyline(geometry); // [lng, lat][]
  if (coords.length < 2) return null;

  // Divide route into at most MAX_SAMPLES chunks
  const step = Math.max(1, Math.floor(coords.length / MAX_SAMPLES));

  const chunks: Array<{ start: number; end: number; midLat: number; midLng: number }> = [];
  for (let i = 0; i < coords.length - 1; i += step) {
    const end = Math.min(i + step, coords.length - 1);
    const midIdx = Math.floor((i + end) / 2);
    chunks.push({
      start: i,
      end,
      midLat: coords[midIdx][1],
      midLng: coords[midIdx][0],
    });
  }

  // Fetch flow data for each chunk midpoint in parallel
  const coloredChunks = await Promise.all(
    chunks.map(async ({ start, end, midLat, midLng }) => {
      const url =
        `${TOMTOM_FLOW_BASE_URL}/${ZOOM_LEVEL}/${midLat.toFixed(5)},${midLng.toFixed(5)}.json` +
        `?key=${encodeURIComponent(tomtomApiKey)}&unit=KMPH&thickness=1`;
      try {
        const res = await fetch(url);
        if (!res.ok) return { start, end, color: '#4A90D9' };
        const json = await res.json();
        // Read ratio directly from the raw response — normalizeTomTomResponse
        // returns null when the segment has < 2 coordinates, which is common
        // for short road segments, causing every chunk to fall back to blue.
        const fsd = json?.flowSegmentData;
        if (fsd && fsd.freeFlowSpeed > 0 && fsd.currentSpeed >= 0) {
          const ratio = Math.min(1, Math.max(0, fsd.currentSpeed / fsd.freeFlowSpeed));
          return { start, end, color: congestionColor(ratio) };
        }
        return { start, end, color: '#4A90D9' };
      } catch {
        return { start, end, color: '#4A90D9' };
      }
    }),
  );

  return {
    type: 'FeatureCollection',
    features: coloredChunks.map(({ start, end, color }) => ({
      type: 'Feature' as const,
      properties: { color },
      geometry: {
        type: 'LineString' as const,
        coordinates: coords.slice(start, end + 1),
      },
    })),
  };
}
