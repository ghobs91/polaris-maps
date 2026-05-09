/**
 * DOT GTFS Offline — offline pre-caching for DOT GTFS feeds.
 *
 * When a user downloads a region for offline use, this module can pre-fetch
 * and cache GTFS feed data for that region so transit lines render without
 * a network connection.
 *
 * Integration point: call `cacheDotGtfsForRegion()` after the offline map
 * download completes in `src/services/regions/downloadService.ts`.
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

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

// ── In-memory offline cache (survives app session, cleared on restart) ─

interface OfflineCacheEntry {
  data: GtfsFeedData;
  cachedAt: number;
  regionId: string;
}

const offlineFeedCache = new Map<string, OfflineCacheEntry>();

// ── Public API ───────────────────────────────────────────────────────

/**
 * Pre-fetch and cache DOT GTFS feeds covering a region.
 *
 * Call after a region download completes. Downloads and parses each
 * matching GTFS feed, storing results in the in-memory offline cache.
 *
 * @param regionId  ID of the downloaded region (e.g. "us-ny-new-york")
 * @param bbox  Bounding box of the downloaded region
 */
export async function cacheDotGtfsForRegion(
  regionId: string,
  bbox: BoundingBox,
): Promise<void> {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;
  const radiusDeg =
    Math.max(bbox.maxLat - bbox.minLat, bbox.maxLng - bbox.minLng) / 2 + 0.3;

  const feeds = await lookupDotGtfsFeeds(centerLat, centerLng, radiusDeg, 6);
  if (feeds.length === 0) return;

  const BATCH_SIZE = 4;
  for (let i = 0; i < feeds.length; i += BATCH_SIZE) {
    const batch = feeds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((feed) =>
        downloadAndCacheOffline(feed, regionId).catch(() => {
          // Silently skip failed feeds
        }),
      ),
    );
  }
}

/**
 * Get cached transit lines for an offline region.
 *
 * @param regionId  Region ID to retrieve lines for
 * @returns  TransitRouteLine[] for the cached region (empty if none cached)
 */
export async function getOfflineDotGtfsLines(
  regionId: string,
): Promise<TransitRouteLine[]> {
  const regionFeeds = [...offlineFeedCache.values()].filter(
    (entry) => entry.regionId === regionId,
  );

  if (regionFeeds.length === 0) return [];

  const config = {
    label: 'Offline DOT GTFS',
    routeTypeFilter: ALL_ROUTE_TYPES,
  };

  const allLines: TransitRouteLine[] = [];
  for (const entry of regionFeeds) {
    try {
      const lines = await convertFeedToLines(entry.data, config);
      allLines.push(...lines);
    } catch {
      // Skip feeds that fail conversion
    }
  }

  return allLines;
}

/**
 * Check if an offline region has cached DOT GTFS data.
 */
export function hasOfflineDotGtfsData(regionId: string): boolean {
  return [...offlineFeedCache.values()].some((e) => e.regionId === regionId);
}

/**
 * Remove cached DOT GTFS data for a region (e.g., when region is deleted).
 */
export function removeOfflineDotGtfsData(regionId: string): void {
  for (const [key, entry] of offlineFeedCache) {
    if (entry.regionId === regionId) offlineFeedCache.delete(key);
  }
}

// ── Internal ─────────────────────────────────────────────────────────

async function downloadAndCacheOffline(
  feed: DotGtfsFeedEntry,
  regionId: string,
): Promise<void> {
  const url = feed.weblink;
  if (!url) return;

  // Don't re-download if already cached for this region
  const existing = offlineFeedCache.get(url);
  if (existing && existing.regionId === regionId) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return;

    const buffer = await res.arrayBuffer();
    const needed = ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt', 'shapes.txt'];
    const files = await extractZipTexts(buffer, needed);

    if (!files.has('routes.txt')) return;

    const data = parseGtfsFeed(files, `dot:${feed.ntdId}`, feed.agencyName);
    if (!data) return;

    offlineFeedCache.set(url, {
      data,
      cachedAt: Date.now(),
      regionId,
    });
  } catch {
    // Silently skip
  } finally {
    clearTimeout(timer);
  }
}
