import { storage } from '../storage/mmkv';
import { getConnectivity } from '../regions/connectivityService';
import { commonsThumbUrl } from '../poi/poiEnricher';
import { fetchWebsitePhotosResult, normalizeWebsiteUrl } from '../poi/websitePhotosService';

/**
 * Cheap per-row thumbnails for search results.
 *
 * Search itself must never wait on photo discovery, so nothing here runs during
 * ranking. A result row asks for a thumbnail when it mounts, and this module
 * answers cache-first, then resolves at most one small image URL per place:
 *
 *  1. `polaris:thumbnail` / `image` tag — already an image URL, no request.
 *  2. Wikidata `P18` → Wikimedia Commons thumb — one tiny API call, cached by
 *     QID, which covers every chain (Starbucks, Dunkin', …) once.
 *  3. Venue website → first discovered photo, reusing the existing scraper and
 *     its disk cache.
 *
 * Failures are negatively cached so a list doesn't re-request a photo-less
 * place on every render, and only a few requests run at a time.
 */

const CACHE_KEY = 'place_search_thumbnails_v1';
/** A resolved photo rarely changes; 60 days keeps the cache small and fresh. */
const TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** Retry a place that had no usable photo sooner than a resolved one. */
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 800;
const MAX_CONCURRENT_FETCHES = 3;
const WIKIDATA_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const REQUEST_TIMEOUT_MS = 6000;
/** Small enough for a list tile, large enough to survive a 3x display. */
const THUMB_WIDTH = 240;

type ThumbnailSource = 'url' | 'wikidata' | 'website';

interface CacheEntry {
  url: string | null;
  cachedAt: number;
}

type CacheMap = Record<string, CacheEntry>;

let memory: CacheMap | null = null;
let loaded = false;

/** In-flight resolutions, so ten Starbucks rows share one Wikidata request. */
const inFlight = new Map<string, Promise<string | null>>();

let activeFetches = 0;
const fetchWaiters: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    fetchWaiters.push(() => {
      activeFetches++;
      resolve();
    });
  });
}

function releaseFetchSlot(): void {
  activeFetches = Math.max(0, activeFetches - 1);
  const next = fetchWaiters.shift();
  if (next) next();
}

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
    // Best-effort: a failed write only means one more request later.
  }
}

function isFresh(entry: CacheEntry): boolean {
  const ttl = entry.url ? TTL_MS : NEGATIVE_TTL_MS;
  return Date.now() - entry.cachedAt <= ttl;
}

function readCache(key: string): CacheEntry | null {
  const entry = load()[key];
  if (!entry) return null;
  return isFresh(entry) ? entry : null;
}

function writeCache(key: string, url: string | null): void {
  const map = load();
  if (!map[key]) {
    const keys = Object.keys(map);
    if (keys.length >= MAX_ENTRIES) {
      let oldestKey = keys[0];
      let oldestAt = Infinity;
      for (const existing of keys) {
        if (map[existing].cachedAt < oldestAt) {
          oldestAt = map[existing].cachedAt;
          oldestKey = existing;
        }
      }
      delete map[oldestKey];
    }
  }
  map[key] = { url, cachedAt: Date.now() };
  persist();
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function wikidataQid(tags: Record<string, string>): string | null {
  const qid = tags['wikidata'] ?? tags['brand:wikidata'] ?? tags['operator:wikidata'];
  return qid && /^Q\d+$/.test(qid) ? qid : null;
}

function websiteUrl(tags: Record<string, string>): string | null {
  const raw = tags['website'] ?? tags['contact:website'] ?? tags['url'];
  if (!raw) return null;
  return normalizeWebsiteUrl(raw) ?? httpUrl(raw);
}

/**
 * Stable cache key + resolution strategy for a place's thumbnail, or null when
 * the place has nothing to resolve from.
 */
export function placeThumbnailSource(tags: Record<string, string>): {
  key: string;
  source: ThumbnailSource;
  value: string;
} | null {
  const direct = httpUrl(tags['polaris:thumbnail']) ?? httpUrl(tags['image']);
  if (direct) return { key: `url:${direct}`, source: 'url', value: direct };

  const qid = wikidataQid(tags);
  if (qid) return { key: `wd:${qid}`, source: 'wikidata', value: qid };

  const site = websiteUrl(tags);
  if (site) return { key: `web:${site}`, source: 'website', value: site };

  return null;
}

/** A resolution attempt: `ok` is false only when the request itself failed. */
interface ThumbnailAttempt {
  url: string | null;
  ok: boolean;
}

async function fetchWikimediaThumb(qid: string): Promise<ThumbnailAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url =
      `${WIKIDATA_ENDPOINT}?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
      `&props=claims&format=json&origin=*`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { url: null, ok: false };
    const data = (await res.json()) as {
      entities?: Record<string, { claims?: Record<string, Array<Record<string, unknown>>> }>;
    };
    const claims = data.entities?.[qid]?.claims;
    const filename = claims?.P18?.[0] as
      | { mainsnak?: { datavalue?: { value?: unknown } } }
      | undefined;
    const value = filename?.mainsnak?.datavalue?.value;
    return {
      url:
        typeof value === 'string' && value.length > 0 ? commonsThumbUrl(value, THUMB_WIDTH) : null,
      ok: true,
    };
  } catch {
    return { url: null, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWebsiteThumb(site: string): Promise<ThumbnailAttempt> {
  try {
    const { urls, ok } = await fetchWebsitePhotosResult(site);
    return { url: httpUrl(urls[0]), ok };
  } catch {
    return { url: null, ok: false };
  }
}

async function resolveUncached(
  resolved: NonNullable<ReturnType<typeof placeThumbnailSource>>,
): Promise<ThumbnailAttempt> {
  if (resolved.source === 'url') return { url: resolved.value, ok: true };

  await acquireFetchSlot();
  try {
    return resolved.source === 'wikidata'
      ? await fetchWikimediaThumb(resolved.value)
      : await fetchWebsiteThumb(resolved.value);
  } finally {
    releaseFetchSlot();
  }
}

/**
 * Cache-only lookup — safe to call during render so a previously seen photo
 * paints immediately instead of fading in.
 */
export function getCachedPlaceThumbnail(tags: Record<string, string>): string | null {
  const resolved = placeThumbnailSource(tags);
  if (!resolved) return null;
  return readCache(resolved.key)?.url ?? null;
}

/** Resolve (or reuse) a place thumbnail URL. Never throws. */
export async function resolvePlaceThumbnail(tags: Record<string, string>): Promise<string | null> {
  const resolved = placeThumbnailSource(tags);
  if (!resolved) return null;

  const cached = readCache(resolved.key);
  if (cached) return cached.url;

  if (resolved.source !== 'url' && !getConnectivity().isConnected) return null;

  const pending = inFlight.get(resolved.key);
  if (pending) return pending;

  const promise = resolveUncached(resolved)
    .then((attempt) => {
      // Only negative-cache a real "no photo" answer; a transport failure is
      // retried next time instead of hidden for the whole negative TTL.
      if (attempt.ok) writeCache(resolved.key, attempt.url);
      return attempt.url;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(resolved.key);
    });

  inFlight.set(resolved.key, promise);
  return promise;
}

/** Drop the whole cache (used by tests / a future "clear data" action). */
export function clearPlaceThumbnailCache(): void {
  memory = {};
  loaded = true;
  inFlight.clear();
  try {
    storage.delete(CACHE_KEY);
  } catch {
    // ignore
  }
}
