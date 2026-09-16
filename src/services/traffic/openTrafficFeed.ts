import type { NormalizedTrafficSegment } from '../../models/traffic';

/** Bounding box in degrees. */
export interface FeedBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * A free/open traffic feed adapter. Implementations must be keyless or
 * free-keyed government/open endpoints — never paid or metered providers.
 */
export interface OpenTrafficFeedAdapter {
  id: string;
  fetchSegments(bounds: FeedBounds): Promise<NormalizedTrafficSegment[]>;
}

interface RawFeedSegment {
  id?: unknown;
  lat?: unknown;
  lng?: unknown;
  speedMph?: unknown;
  freeFlowSpeedMph?: unknown;
  confidence?: unknown;
  timestamp?: unknown;
}

const DEFAULT_CONFIDENCE = 0.7;

/**
 * Normalize a documented JSON feed response into `NormalizedTrafficSegment[]`.
 * Accepts either a bare array or `{ segments: [...] }`. Invalid rows are
 * dropped rather than throwing, so a partially malformed feed is non-fatal.
 */
export function normalizeOpenFeedResponse(payload: unknown): NormalizedTrafficSegment[] {
  const raw = Array.isArray(payload)
    ? payload
    : (payload as { segments?: unknown } | null | undefined)?.segments;
  if (!Array.isArray(raw)) return [];

  const now = Math.floor(Date.now() / 1000);
  const segments: NormalizedTrafficSegment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i] as RawFeedSegment;
    const lat = Number(seg?.lat);
    const lng = Number(seg?.lng);
    const speedMph = Number(seg?.speedMph);
    const freeFlowSpeedMph = Number(seg?.freeFlowSpeedMph);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!Number.isFinite(speedMph) || !Number.isFinite(freeFlowSpeedMph) || freeFlowSpeedMph <= 0) {
      continue;
    }

    const confidence = Number.isFinite(Number(seg?.confidence))
      ? Number(seg?.confidence)
      : DEFAULT_CONFIDENCE;
    const timestamp = Number.isFinite(Number(seg?.timestamp)) ? Number(seg?.timestamp) : now;

    segments.push({
      id: typeof seg?.id === 'string' ? seg.id : `open:${lat.toFixed(5)},${lng.toFixed(5)}:${i}`,
      coordinates: [[lng, lat]],
      currentSpeedMph: speedMph,
      freeFlowSpeedMph,
      congestionRatio: Math.max(0, Math.min(1, speedMph / freeFlowSpeedMph)),
      confidence,
      source: 'open_feed',
      timestamp,
    });
  }

  return segments;
}

/** Parse the configured comma-separated feed URL list. */
export function getConfiguredFeedUrls(
  env: string | undefined = process.env.EXPO_PUBLIC_OPEN_TRAFFIC_FEEDS,
): string[] {
  if (!env) return [];
  return env
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function fetchOne(url: string, bounds: FeedBounds): Promise<NormalizedTrafficSegment[]> {
  try {
    const query = `bbox=${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}${query}`);
    if (!response.ok) return [];
    return normalizeOpenFeedResponse(await response.json());
  } catch {
    // Unreachable or malformed feeds contribute no data.
    return [];
  }
}

export function createOpenFeedAdapter(url: string): OpenTrafficFeedAdapter {
  return { id: url, fetchSegments: (bounds) => fetchOne(url, bounds) };
}

/** Fetch and normalize every configured open feed for a bounding box. */
export async function fetchOpenTrafficSegments(
  bounds: FeedBounds,
): Promise<NormalizedTrafficSegment[]> {
  const urls = getConfiguredFeedUrls();
  if (urls.length === 0) return [];
  const results = await Promise.all(urls.map((url) => fetchOne(url, bounds)));
  return results.flat();
}
