/**
 * DOT GTFS Feed Fetcher
 *
 * Downloads, unzips, parses, and caches GTFS static data from DOT-listed
 * feeds found via the spatial index in `dotGtfsIndex.ts`.
 *
 * Supports all transit modes (bus, rail, subway, tram, ferry, cable car).
 * Handles edge cases: 404/500 URLs, malformed zips, missing shapes, and
 * duplicate route IDs across feeds.
 *
 * Cached in-memory keyed by feed URL, TTL 24 hours. LRU eviction at 30 entries.
 */

import { lookupDotGtfsFeeds, type DotGtfsFeedEntry } from './dotGtfsIndex';
import {
  extractZipTexts,
  parseGtfsFeed,
  convertFeedToLines,
  ALL_ROUTE_TYPES,
  type GtfsFeedData,
} from './gtfsParser';
import type { TransitRouteLine } from '../../models/transit';
import { TRANSIT_FEED_CACHE_TTL_MS } from '../../constants/config';
import { useTransitStore } from '../../stores/transitStore';
import { storage } from '../storage/mmkv';

// ── Cache ────────────────────────────────────────────────────────────

interface FeedCacheEntry {
  data: GtfsFeedData;
  fetchedAt: number;
}

const feedCache = new Map<string, FeedCacheEntry>();
const CACHE_TTL = TRANSIT_FEED_CACHE_TTL_MS;
const MAX_CACHE_ENTRIES = 30;

// ── Persistent cache (MMKV) ─────────────────────────────────────────

/** 7 days — GTFS feeds update seasonally. */
const PERSISTENT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function getPersistentCacheKey(url: string): string {
  // Hash the URL to keep keys short
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `dot_gtfs:${Math.abs(hash).toString(36)}`;
}

function loadDotPersistentCache(url: string): TransitRouteLine[] | null {
  try {
    const key = getPersistentCacheKey(url);
    const raw = storage.getString(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { lines: TransitRouteLine[]; cachedAt: number };
    if (Date.now() - entry.cachedAt > PERSISTENT_CACHE_TTL) {
      storage.delete(key);
      return null;
    }
    return entry.lines;
  } catch {
    return null;
  }
}

function saveDotPersistentCache(url: string, lines: TransitRouteLine[]): void {
  try {
    const key = getPersistentCacheKey(url);
    storage.set(key, JSON.stringify({ lines, cachedAt: Date.now() }));
  } catch {
    // Non-fatal
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Fetch transit route lines from DOT GTFS feeds covering a geographic area.
 *
 * @param lat  Viewport center latitude
 * @param lng  Viewport center longitude
 * @param radiusDeg  Search radius in degrees (~0.3 = ~33 km)
 * @returns  Combined TransitRouteLine[] from all matching feeds
 */
export async function fetchDotGtfsLines(
  lat: number,
  lng: number,
  radiusDeg: number,
): Promise<TransitRouteLine[]> {
  console.warn(`[dot-gtfs] fetchDotGtfsLines called at (${lat.toFixed(2)}, ${lng.toFixed(2)}) radius=${radiusDeg.toFixed(2)}°`);
  const feeds = await lookupDotGtfsFeeds(lat, lng, radiusDeg, 8);
  if (feeds.length === 0) return [];

  console.warn(
    `[dot-gtfs] Found ${feeds.length} feeds for (${lat.toFixed(2)}, ${lng.toFixed(2)}) ` +
    `radius ${radiusDeg.toFixed(2)}°: ${feeds.map((f) => f.agencyName).join(', ')}`,
  );

  // Notify loading state via transit store
  const primaryAgency = feeds[0]?.agencyName ?? null;
  const otherCount = feeds.length - 1;
  const loadingLabel =
    otherCount > 0
      ? `${primaryAgency} + ${otherCount} other${otherCount > 1 ? 's' : ''}`
      : primaryAgency;
  useTransitStore.getState().setGtfsLoadingAgency(loadingLabel);

  try {
    // Filter out already-cached feeds
    const uncached = feeds.filter((f) => {
      const cached = feedCache.get(f.weblink);
      return !cached || Date.now() - cached.fetchedAt >= CACHE_TTL;
    });

    // Download and parse uncached feeds (max 4 concurrent, 60s timeout each)
    const BATCH_SIZE = 4;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((feed) => fetchAndCacheDotFeed(feed).catch(() => null)),
      );
    }

    // Convert all cached feed data to TransitRouteLine[]
    const allLines: TransitRouteLine[] = [];
    const config = {
      label: 'DOT GTFS',
      routeTypeFilter: ALL_ROUTE_TYPES,
      filterByRouteType: false, // Include ALL routes regardless of type
    };

    for (const feed of feeds) {
      // Check persistent cache first
      const persisted = loadDotPersistentCache(feed.weblink);
      if (persisted) {
        console.warn(`[dot-gtfs] ${feed.agencyName} loaded from persistent cache (${persisted.length} lines)`);
        allLines.push(...persisted);
        continue;
      }

      const cached = feedCache.get(feed.weblink);
      if (!cached) continue;

      try {
        const lines = await convertFeedToLines(
          { ...cached.data, feedId: `dot:${feed.ntdId}` },
          { ...config, label: feed.agencyName },
        );
        if (lines.length === 0) {
          console.warn(
            `[dot-gtfs] Feed parsed but produced 0 lines: ${feed.agencyName} ` +
            `(${cached.data.routes.length} routes, ${cached.data.shapes.size} shapes, ${cached.data.trips.length} trips)`,
          );
        } else {
          // Save to persistent cache
          saveDotPersistentCache(feed.weblink, lines);
        }
        allLines.push(...lines);
      } catch {
        // Skip feeds that fail conversion
      }
    }

    if (feeds.length > 0 && allLines.length === 0) {
      console.warn('[dot-gtfs] Found feeds but all produced 0 lines');
    }

    return allLines;
  } finally {
    useTransitStore.getState().setGtfsLoadingAgency(null);
  }
}

// ── Internal ─────────────────────────────────────────────────────────

async function fetchAndCacheDotFeed(feed: DotGtfsFeedEntry): Promise<void> {
  let url = feed.weblink;
  if (!url) return;

  // Upgrade HTTP to HTTPS to avoid iOS ATS policy blocks
  url = url.replace(/^http:\/\//i, 'https://');

  // WMATA API requires a key. Skip if not configured (dedicated endpoint handles it).
  if (url.includes('api.wmata.com')) {
    const wmataKey =
      (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WMATA_API_KEY) || '';
    if (!wmataKey) {
      console.warn(`[dot-gtfs] Skipping WMATA feed (no API key): ${feed.agencyName}`);
      return;
    }
    url = `${url}?api_key=${wmataKey}`;
  }

  // Check if already cached
  const cached = feedCache.get(feed.weblink);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[dot-gtfs] Feed URL returned ${res.status}: ${feed.agencyName} (${url})`);
      return;
    }

    const buffer = await res.arrayBuffer();
    // Only extract files needed for line geometry (skip stop_times.txt — can be 100MB+ uncompressed)
    const needed = ['routes.txt', 'stops.txt', 'trips.txt', 'shapes.txt'];
    const files = await extractZipTexts(buffer, needed);

    if (!files.has('routes.txt')) {
      console.warn(`[dot-gtfs] Feed has no routes.txt: ${feed.agencyName}`);
      return;
    }

    const data = parseGtfsFeed(files, `dot:${feed.ntdId}`, feed.agencyName);
    if (!data) return;

    // Cache it (keyed by original URL, not API-key-augmented URL)
    feedCache.set(feed.weblink, { data, fetchedAt: Date.now() });
    if (feedCache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...feedCache.entries()].sort(
        (a, b) => a[1].fetchedAt - b[1].fetchedAt,
      );
      feedCache.delete(oldest[0][0]);
    }
  } catch (err) {
    console.warn(`[dot-gtfs] Failed to fetch feed: ${feed.agencyName}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Clear all cached DOT GTFS data (in-memory + persistent). Useful when changing regions.
 */
export function clearDotGtfsCache(): void {
  feedCache.clear();
  // Clear persistent cache keys
  const keys = storage.getAllKeys();
  for (const key of keys) {
    if (key.startsWith('dot_gtfs:')) {
      storage.delete(key);
    }
  }
}
