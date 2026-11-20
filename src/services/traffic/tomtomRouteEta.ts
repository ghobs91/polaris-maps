import { tomtomApiKey } from '../../constants/config';
import { decodePolyline } from '../../utils/polyline';
import { TtlCache } from '../../utils/ttlCache';
import { getStorageSync } from '../storage/mmkv';
import {
  canCallTomTom,
  isTomTomConfigured,
  noteTomTomNetworkError,
  noteTomTomRequest,
  noteTomTomResponse,
} from './tomtomAccess';

const TOMTOM_ROUTE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
/** Route ETAs are stable for a few minutes and are re-requested every 60 s. */
const ROUTE_ETA_TTL_MS = 5 * 60 * 1000;
const ROUTE_ETA_CACHE_ENTRIES = 32;
/** Persisted mirror of the in-memory cache (see `readPersistedRouteEta`). */
const ROUTE_ETA_STORAGE_KEY = 'traffic.route-eta.v1';

interface RouteEta {
  travelTimeSeconds: number;
  trafficDelaySeconds: number;
}

interface PersistedRouteEta extends RouteEta {
  /** Epoch ms the provider answered. */
  storedAt: number;
}

const routeEtaCache = new TtlCache<string, RouteEta>(ROUTE_ETA_TTL_MS, ROUTE_ETA_CACHE_ENTRIES);

/**
 * Read the persisted mirror of the ETA cache.
 *
 * The in-memory cache dies with the process, so before this existed the first
 * directions request after every relaunch re-asked the provider for the exact
 * same route — the storage layer throws when MMKV is not initialised yet, and
 * that simply degrades to the old behaviour.
 */
function readRouteEtaStore(): Record<string, PersistedRouteEta> {
  try {
    const raw = getStorageSync().getString(ROUTE_ETA_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, PersistedRouteEta>;
  } catch {
    return {};
  }
}

function isValidEntry(entry: unknown): entry is PersistedRouteEta {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<PersistedRouteEta>;
  return (
    typeof candidate.travelTimeSeconds === 'number' &&
    Number.isFinite(candidate.travelTimeSeconds) &&
    typeof candidate.trafficDelaySeconds === 'number' &&
    Number.isFinite(candidate.trafficDelaySeconds) &&
    typeof candidate.storedAt === 'number' &&
    Number.isFinite(candidate.storedAt)
  );
}

/** Fresh persisted answer for this key, or null (also drops expired entries). */
function readPersistedRouteEta(cacheKey: string, now: number): RouteEta | null {
  const entry = readRouteEtaStore()[cacheKey];
  if (!isValidEntry(entry)) return null;
  if (now - entry.storedAt >= ROUTE_ETA_TTL_MS) return null;
  return {
    travelTimeSeconds: entry.travelTimeSeconds,
    trafficDelaySeconds: entry.trafficDelaySeconds,
  };
}

/** Persist one answer, pruning expired entries and keeping the newest ones. */
function writePersistedRouteEta(cacheKey: string, eta: RouteEta, now: number): void {
  try {
    const kept = Object.entries(readRouteEtaStore()).filter(
      ([key, entry]) =>
        key !== cacheKey && isValidEntry(entry) && now - entry.storedAt < ROUTE_ETA_TTL_MS,
    );
    // Oldest first, so the cap below drops the least useful entries.
    kept.sort((a, b) => a[1].storedAt - b[1].storedAt);
    const trimmed = kept.slice(Math.max(0, kept.length - (ROUTE_ETA_CACHE_ENTRIES - 1)));
    const next: Record<string, PersistedRouteEta> = {};
    for (const [key, entry] of trimmed) next[key] = entry;
    next[cacheKey] = { ...eta, storedAt: now };
    getStorageSync().set(ROUTE_ETA_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* cache-only: a failed write just costs one provider request later */
  }
}

function routeEtaCacheKey(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): string {
  return `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}-${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;
}

/**
 * Fetch a traffic-adjusted ETA from TomTom Calculate Route API.
 * Takes origin/destination (from the Valhalla route endpoints) and returns
 * travel time in seconds accounting for current traffic conditions.
 *
 * Returns null if the API key is missing or the request fails.
 */
export async function fetchTomTomRouteEta(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<RouteEta | null> {
  if (!isTomTomConfigured()) return null;

  const cacheKey = routeEtaCacheKey(origin, destination);
  const cached = routeEtaCache.get(cacheKey) ?? readPersistedRouteEta(cacheKey, Date.now());
  // Deliberately not re-inserted into the in-memory cache: its TTL would
  // restart, and a persisted answer that is nearly expired would then keep
  // being served for a full extra window.
  if (cached) return cached;

  if (!canCallTomTom()) return null;
  noteTomTomRequest();

  const coords = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
  const url = `${TOMTOM_ROUTE_URL}/${coords}/json?key=${encodeURIComponent(tomtomApiKey)}&traffic=true&travelMode=car`;

  try {
    const res = await fetch(url);
    noteTomTomResponse(res.status);
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary) return null;

    const result: RouteEta = {
      travelTimeSeconds: summary.travelTimeInSeconds ?? 0,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
    };
    routeEtaCache.set(cacheKey, result);
    writePersistedRouteEta(cacheKey, result, Date.now());
    return result;
  } catch {
    noteTomTomNetworkError();
    return null;
  }
}

/** Test-only: clear the ETA cache (memory + persisted mirror). */
export function __resetTomTomRouteEtaCacheForTests(): void {
  routeEtaCache.clear();
  try {
    getStorageSync().delete(ROUTE_ETA_STORAGE_KEY);
  } catch {
    /* MMKV not initialised in this test — nothing persisted to clear */
  }
}

/**
 * Fetch a route-ETA preview only when the device does not already hold flow
 * for the route's weekday + hour bucket.
 *
 * The panels used to call the Calculate Route API on every directions request.
 * Saved flow covering the route (same weekday + hour, up to a month old) is the
 * answer the API would return anyway, so the request is skipped — and the
 * preview ETA is then filled from the local traffic set by
 * `seedRoutePreviewTrafficEta` (`services/traffic/routePreviewEta`), which runs
 * the same computation the in-navigation refresh uses. Returning null here
 * without that seed is what made the preview show the router's traffic-free
 * duration while navigation showed a different number.
 */
export async function fetchRouteTrafficEtaIfUnsaved(
  geometry: string,
): Promise<{ travelTimeSeconds: number; trafficDelaySeconds: number } | null> {
  const coords = decodePolyline(geometry);
  if (coords.length < 2) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const saved = require('./trafficSavedFlowIndex') as typeof import('./trafficSavedFlowIndex');
    if (await saved.hasSavedFlowForRoute(coords)) return null;
  } catch {
    /* saved-flow store unavailable: fall through to the provider */
  }
  return fetchRouteTrafficEta(geometry);
}

/**
 * Fetch traffic-adjusted ETA using the route geometry's start/end points.
 * Convenience wrapper that extracts endpoints from an encoded polyline.
 */
export async function fetchRouteTrafficEta(
  geometry: string,
): Promise<{ travelTimeSeconds: number; trafficDelaySeconds: number } | null> {
  const coords = decodePolyline(geometry);
  if (coords.length < 2) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];

  return fetchTomTomRouteEta({ lat: first[1], lng: first[0] }, { lat: last[1], lng: last[0] });
}
