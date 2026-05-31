/**
 * GTFS Static Feed Fetcher
 *
 * Downloads official GTFS feeds via MobilityData catalog or direct URLs,
 * unzips, and parses the CSV files into typed structures for routes, stops,
 * shapes, trips, and stop_times.
 *
 * Parsing logic is shared via `gtfsParser.ts` (used by both MobilityData
 * and DOT GTFS registry paths).
 *
 * Only rail-related feeds are parsed (route_type 1=subway, 2=rail).
 * Feed discovery is cached for 24 hours; parsed data is cached in memory.
 */

import { discoverFeeds } from './transitFeedService';
import type { TransitFeed } from '../../models/transit';
import type { TransitRouteLine } from '../../models/transit';
import { TRANSIT_FEED_CACHE_TTL_MS } from '../../constants/config';
import { storage } from '../storage/mmkv';

// Re-export shared types (used by callers like transitLineFetcher.ts)
export type {
  GtfsRoute,
  GtfsStop,
  GtfsTrip,
  GtfsStopTime,
  GtfsShapePoint,
  GtfsFeedData,
  GtfsFetcherConfig,
} from './gtfsParser';

import {
  extractZipTexts,
  parseCsv,
  parseGtfsColor,
  routeTypeToMode,
  convertFeedToLines,
  parseGtfsFeed,
  type GtfsFetcherConfig,
  type GtfsFeedData,
  type GtfsRoute,
  type GtfsStop,
  type GtfsTrip,
  type GtfsStopTime,
  type GtfsShapePoint,
} from './gtfsParser';

// ── Persistent cache (MMKV) ─────────────────────────────────────────

/** 7 days — GTFS feeds update seasonally, not daily. */
const PERSISTENT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function getPersistentCacheKey(label: string): string {
  return `transit_lines:${label}`;
}

function loadFromPersistentCache(label: string): TransitRouteLine[] | null {
  try {
    const key = getPersistentCacheKey(label);
    const raw = storage.getString(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { lines: TransitRouteLine[]; cachedAt: number };
    if (Date.now() - entry.cachedAt > PERSISTENT_CACHE_TTL) {
      storage.delete(key);
      return null;
    }
    console.warn(
      `[gtfs-static] ${label} loaded from persistent cache (${entry.lines.length} lines)`,
    );
    return entry.lines;
  } catch {
    return null;
  }
}

function saveToPersistentCache(label: string, lines: TransitRouteLine[]): void {
  try {
    const key = getPersistentCacheKey(label);
    const entry = JSON.stringify({ lines, cachedAt: Date.now() });
    storage.set(key, entry);
    console.warn(`[gtfs-static] ${label} saved to persistent cache (${lines.length} lines)`);
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

// ── Feed data cache ─────────────────────────────────────────────────

interface FeedCacheEntry {
  data: GtfsFeedData;
  fetchedAt: number;
}

const feedDataCache = new Map<string, FeedCacheEntry>();
const FEED_DATA_CACHE_TTL = TRANSIT_FEED_CACHE_TTL_MS;

// ── Rail route types (GTFS route_type) ──────────────────────────────

/** GTFS route_type values we consider "rail": 1=subway, 2=rail */
const RAIL_ROUTE_TYPES = new Set([1, 2]);

// ── Public API ──────────────────────────────────────────────────────

/**
 * Discover and download GTFS static feeds for a bounding box.
 * Returns parsed feed data for all rail-related feeds in the area.
 * Results are cached in memory.
 */
export async function fetchGtfsFeeds(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<GtfsFeedData[]> {
  let feeds: TransitFeed[];
  try {
    feeds = await discoverFeeds(minLat, minLng, maxLat, maxLng);
  } catch {
    return [];
  }

  // Filter to feeds that have a download URL and are likely rail-related
  const railFeeds = feeds.filter((f) => {
    if (!f.latest_dataset?.hosted_url) return false;
    const name = (f.feed_name ?? f.provider ?? '').toLowerCase();
    return (
      name.includes('rail') ||
      name.includes('subway') ||
      name.includes('metro') ||
      name.includes('tram') ||
      name.includes('light rail') ||
      name.includes('transit') ||
      name.includes('path') ||
      (!name.includes('bus') && !name.includes('ferry'))
    );
  });

  const results = await Promise.all(railFeeds.slice(0, 8).map((f) => fetchAndParseMobilityFeed(f)));

  return results.filter(
    (d): d is GtfsFeedData =>
      d !== null && d.routes.some((r) => RAIL_ROUTE_TYPES.has(r.route_type)),
  );
}

async function fetchAndParseMobilityFeed(feed: TransitFeed): Promise<GtfsFeedData | null> {
  const url = feed.latest_dataset?.hosted_url;
  if (!url) return null;

  const cached = feedDataCache.get(feed.id);
  if (cached && Date.now() - cached.fetchedAt < FEED_DATA_CACHE_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();

    const needed = [
      'agency.txt',
      'routes.txt',
      'stops.txt',
      'trips.txt',
      'stop_times.txt',
      'shapes.txt',
    ];
    const files = await extractZipTexts(buffer, needed);

    const agencyRow = parseCsv(files.get('agency.txt') ?? '')[0];

    const data = parseGtfsFeed(
      files,
      feed.id,
      feed.feed_name ?? agencyRow?.agency_name ?? feed.provider,
      { routeTypeFilter: [...RAIL_ROUTE_TYPES] },
    );

    if (!data) return null;

    // Cache it
    feedDataCache.set(feed.id, { data, fetchedAt: Date.now() });
    if (feedDataCache.size > 20) {
      const oldest = [...feedDataCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      feedDataCache.delete(oldest[0][0]);
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Clear all cached GTFS data (in-memory + persistent). Useful when changing regions.
 */
export function clearGtfsCache(): void {
  feedDataCache.clear();
  gtfsLineCache.clear();
  // Clear persistent cache keys
  const keys = storage.getAllKeys();
  for (const key of keys) {
    if (key.startsWith('transit_lines:')) {
      storage.delete(key);
    }
  }
}

// ── Config-driven transit line fetcher ────────────────────────────────

const gtfsLineCache = new Map<string, TransitRouteLine[]>();
const gtfsLineFetchInFlight = new Map<string, Promise<TransitRouteLine[]>>();

/**
 * Fetch transit route lines from a GTFS static feed.
 *
 * If `config.feedUrl` is provided the feed is downloaded directly from
 * that URL. Otherwise the MobilityData feed catalog is used to discover
 * feeds for the bounding-box area.
 *
 * Returns an empty array on failure — never throws.
 */
export async function fetchGtfsStaticLines(config: GtfsFetcherConfig): Promise<TransitRouteLine[]> {
  const cacheKey = config.label;

  // 1. Check in-memory cache
  const cached = gtfsLineCache.get(cacheKey);
  if (cached) return cached;

  // 2. Check persistent cache (MMKV)
  const persisted = loadFromPersistentCache(cacheKey);
  if (persisted) {
    gtfsLineCache.set(cacheKey, persisted);
    return persisted;
  }

  let inFlight = gtfsLineFetchInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<TransitRouteLine[]> => {
    try {
      let feedData: GtfsFeedData | null = null;

      if (config.feedUrl) {
        feedData = await fetchFeedFromUrl(config.feedUrl, config.label, config.timeoutMs);
      }

      if (!feedData) return [];

      const lines = await convertFeedToLines(feedData, config);
      console.warn(`[gtfs-static] ${config.label} converted to ${lines.length} TransitRouteLines`);
      gtfsLineCache.set(cacheKey, lines);
      saveToPersistentCache(cacheKey, lines);
      return lines;
    } catch {
      return [];
    } finally {
      gtfsLineFetchInFlight.delete(cacheKey);
    }
  })();

  gtfsLineFetchInFlight.set(cacheKey, inFlight);
  return inFlight;
}

async function fetchFeedFromUrl(
  url: string,
  label: string,
  timeoutMs = 40_000,
): Promise<GtfsFeedData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.warn(`[gtfs-static] Downloading ${label} from ${url}`);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[gtfs-static] ${label} HTTP ${res.status}: ${url}`);
      return null;
    }
    const buffer = await res.arrayBuffer();
    console.warn(`[gtfs-static] ${label} downloaded ${(buffer.byteLength / 1024).toFixed(0)} KB`);

    // Only extract files needed for line geometry (skip stop_times.txt — 192MB uncompressed for CTA, kills perf)
    const needed = ['routes.txt', 'stops.txt', 'trips.txt', 'shapes.txt'];
    const files = await extractZipTexts(buffer, needed);
    console.warn(
      `[gtfs-static] ${label} extracted files: ${[...files.keys()].join(', ') || '(none)'}`,
    );

    const feed = parseGtfsFeed(files, `direct:${label}`, label);
    if (feed) {
      console.warn(
        `[gtfs-static] ${label} parsed: ${feed.routes.length} routes, ${feed.shapes.size} shapes`,
      );
    } else {
      console.warn(`[gtfs-static] ${label} parseGtfsFeed returned null (no routes.txt?)`);
    }
    return feed;
  } catch (err) {
    console.warn(`[gtfs-static] ${label} fetch error:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for testing. */
export function __clearGtfsLineCache(): void {
  gtfsLineCache.clear();
  gtfsLineFetchInFlight.clear();
}
