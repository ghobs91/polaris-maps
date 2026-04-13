import type { NormalizedTrafficSegment } from '../../models/traffic';
import { hereApiKey, HERE_FLOW_BASE_URL } from '../../constants/config';
import type { ViewportBounds } from './tomtomFetcher';

export interface HEREFlowResponse {
  results: Array<{
    location: {
      shape: {
        links: Array<{
          points: Array<{ lat: number; lng: number }>;
          length: number;
        }>;
      };
    };
    currentFlow: {
      speed: number;
      freeFlow: number;
      jamFactor: number;
      confidence?: number;
    };
  }>;
}

/** Hash two points to produce a stable segment ID suffix. */
function hashPoints(
  first: { lat: number; lng: number },
  last: { lat: number; lng: number },
): string {
  const raw = `${first.lat.toFixed(5)},${first.lng.toFixed(5)}-${last.lat.toFixed(5)},${last.lng.toFixed(5)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Normalize a single HERE Traffic Flow result into NormalizedTrafficSegments.
 * Each link in the result becomes a separate segment.
 * Returns empty array if data is invalid (< 2 points or freeFlow <= 0).
 */
export function normalizeHEREResponse(
  result: HEREFlowResponse['results'][number],
): NormalizedTrafficSegment[] {
  const { currentFlow, location } = result;
  if (!currentFlow || currentFlow.freeFlow <= 0) return [];

  const segments: NormalizedTrafficSegment[] = [];
  const ratio = Math.min(1, Math.max(0, currentFlow.speed / currentFlow.freeFlow));

  for (const link of location.shape.links) {
    if (link.points.length < 2) continue;

    const first = link.points[0];
    const last = link.points[link.points.length - 1];

    segments.push({
      id: `here:${hashPoints(first, last)}`,
      coordinates: link.points.map((p) => [p.lng, p.lat] as [number, number]),
      currentSpeedMph: currentFlow.speed * 0.621371,
      freeFlowSpeedMph: currentFlow.freeFlow * 0.621371,
      congestionRatio: ratio,
      confidence: currentFlow.confidence ?? 0.85,
      source: 'here',
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  return segments;
}

/**
 * Fetch traffic data from the HERE Traffic Flow v7 API for a given viewport.
 * Returns normalized segments; returns empty array if API key is missing or request fails.
 */
export async function fetchHERETraffic(
  viewport: ViewportBounds,
): Promise<NormalizedTrafficSegment[]> {
  if (!hereApiKey) return [];

  const bbox = `bbox:${viewport.west},${viewport.south},${viewport.east},${viewport.north}`;
  const url = `${HERE_FLOW_BASE_URL}?apiKey=${encodeURIComponent(hereApiKey)}&in=${encodeURIComponent(bbox)}&locationReferencing=shape`;

  try {
    const response = await fetch(url);
    if (!response.ok) return [];

    const data: HEREFlowResponse = await response.json();
    if (!data.results) return [];

    const segments: NormalizedTrafficSegment[] = [];
    for (const result of data.results) {
      segments.push(...normalizeHEREResponse(result));
    }
    return segments;
  } catch {
    return [];
  }
}
