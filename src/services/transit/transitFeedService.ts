import {
  MOBILITY_DB_API_URL,
  mobilityDbRefreshToken,
  TRANSIT_FEED_CACHE_TTL_MS,
} from '../../constants/config';
import type { TransitFeed, TransitRealtimeFeed } from '../../models/transit';

// ── Token management ────────────────────────────────────────────────

let accessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  if (!mobilityDbRefreshToken) {
    throw new Error('EXPO_PUBLIC_MOBILITY_DB_REFRESH_TOKEN is not configured');
  }

  const res = await fetch(`${MOBILITY_DB_API_URL}/v1/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: mobilityDbRefreshToken }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MobilityData auth failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in?: number };
  accessToken = json.access_token;
  // Default to 55 minutes if expires_in isn't provided (tokens are valid 1 hour)
  tokenExpiresAt = Date.now() + ((json.expires_in ?? 3300) - 60) * 1000;
  return accessToken;
}

async function authFetch(path: string, params?: Record<string, string>): Promise<Response> {
  const token = await getAccessToken();
  const url = new URL(path, MOBILITY_DB_API_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`MobilityData API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

// ── Feed cache ──────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const feedCache = new Map<string, CacheEntry<TransitFeed[]>>();

function cacheKey(lat: number, lng: number): string {
  // Round to ~0.1° grid for cache bucketing (~11km)
  return `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lng * 10) / 10).toFixed(1)}`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Discover GTFS feeds near a geographic bounding box.
 * Results are cached for 24 hours since feed catalogs change infrequently.
 */
export async function discoverFeeds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<TransitFeed[]> {
  const key = cacheKey((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TRANSIT_FEED_CACHE_TTL_MS) {
    return cached.data;
  }

  const res = await authFetch('/v1/gtfs_feeds', {
    dataset_latitudes: `${minLat},${maxLat}`,
    dataset_longitudes: `${minLng},${maxLng}`,
    bounding_filter_method: 'partially_enclosed',
    status: 'active',
    limit: '50',
  });

  const feeds = (await res.json()) as TransitFeed[];
  feedCache.set(key, { data: feeds, fetchedAt: Date.now() });

  // Evict old cache entries
  if (feedCache.size > 50) {
    const oldest = [...feedCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    for (let i = 0; i < oldest.length - 50; i++) feedCache.delete(oldest[i][0]);
  }

  return feeds;
}

/**
 * Get GTFS-RT (realtime) feeds associated with a GTFS feed.
 */
export async function getRealtimeFeeds(feedId: string): Promise<TransitRealtimeFeed[]> {
  const res = await authFetch(`/v1/gtfs_feeds/${encodeURIComponent(feedId)}/gtfs_rt_feeds`);
  return (await res.json()) as TransitRealtimeFeed[];
}

/**
 * Search feeds by text query (provider name, location, etc.).
 */
export async function searchFeeds(
  query: string,
  options?: { dataType?: 'gtfs' | 'gtfs_rt' | 'gbfs'; limit?: number },
): Promise<TransitFeed[]> {
  const res = await authFetch('/v1/search', {
    search_query: query,
    data_type: options?.dataType ?? 'gtfs',
    status: 'active',
    limit: String(options?.limit ?? 20),
  });

  const json = (await res.json()) as { results?: TransitFeed[] };
  return json.results ?? [];
}

/** Check if the feed service is configured (has a refresh token). */
export function isTransitFeedConfigured(): boolean {
  return !!mobilityDbRefreshToken;
}
