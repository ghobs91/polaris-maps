import { storage } from '../storage/mmkv';

/**
 * Disk-backed cache of website photo URLs discovered for saved places.
 *
 * Scraping a venue website is the expensive part of showing a place's photos;
 * the image bytes themselves are cached by expo-image. Persisting the resolved
 * URL list (not the bytes) means reopening a large list never re-scrapes every
 * site — the strip renders instantly from cache and only re-fetches once the
 * entries go stale.
 */

const CACHE_KEY = 'place_website_photos_v1';
/** Re-scrape a site's photos only after this long (2 months). */
const TTL_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;

export const MAX_PLACE_PHOTOS = 3;

interface CacheEntry {
  urls: string[];
  cachedAt: number;
}

type CacheMap = Record<string, CacheEntry>;

let memory: CacheMap | null = null;
let loaded = false;

function load(): CacheMap {
  if (loaded && memory) return memory;
  loaded = true;
  try {
    const raw = storage.getString(CACHE_KEY);
    memory = raw ? (JSON.parse(raw) as CacheMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function persist(): void {
  try {
    storage.set(CACHE_KEY, JSON.stringify(memory ?? {}));
  } catch {
    // Storage is best-effort — a failed write just means a re-scrape later.
  }
}

/** Cached photo URLs for a page, or null when missing/stale. */
export function getCachedPlacePhotos(pageUrl: string): string[] | null {
  if (!pageUrl) return null;
  const map = load();
  const entry = map[pageUrl];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    delete map[pageUrl];
    persist();
    return null;
  }
  return entry.urls;
}

/** Store the photo URLs discovered for a page (bounded + LRU-evicted). */
export function setCachedPlacePhotos(pageUrl: string, urls: string[]): void {
  if (!pageUrl) return;
  const map = load();
  const keys = Object.keys(map);
  if (!map[pageUrl] && keys.length >= MAX_ENTRIES) {
    let oldestKey = keys[0];
    let oldestAt = Infinity;
    for (const key of keys) {
      if (map[key].cachedAt < oldestAt) {
        oldestAt = map[key].cachedAt;
        oldestKey = key;
      }
    }
    delete map[oldestKey];
  }
  map[pageUrl] = { urls: urls.slice(0, MAX_PLACE_PHOTOS), cachedAt: Date.now() };
  persist();
}

/** Drop the whole cache (used by tests / a future "clear data" action). */
export function clearPlacePhotoCache(): void {
  memory = {};
  loaded = true;
  try {
    storage.delete(CACHE_KEY);
  } catch {
    // ignore
  }
}
