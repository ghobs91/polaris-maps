/**
 * Unified street-level imagery lookup.
 *
 * Sources, in result precedence order:
 *   1. Google Street View — default-on exception to the no-corporate-cloud
 *      rule (no API key needed), online-only, never cached. Leads the lookup
 *      wherever it has coverage. See `streetlevelService` for the protocol.
 *   2. Mapillary — opt-in exception to the no-corporate-cloud rule: only
 *      queried when `EXPO_PUBLIC_MAPILLARY_TOKEN` is configured, online-only,
 *      never cached for offline.
 *   3. Panoramax — open (CC-BY-SA), no token, always queried; follows the
 *      others, most recently captured panoramas first.
 *
 * This is separate from the P2P `street_imagery` feed (see `browseService`),
 * which stays the primary, offline-capable source. Results here are online
 * supplements for the 3D panorama viewer.
 */

import { MAPILLARY_TOKEN, PANORAMAX_SEARCH_URL } from '../../constants/config';
import { haversineMeters } from '../../utils/routeSnap';
import {
  buildTileGrids,
  findGoogleStreetViewPano,
  googlePermalink,
  googleThumbnailUrl,
  type StreetViewTileGrid,
} from './streetlevelService';

export type StreetViewSource = 'panoramax' | 'mapillary' | 'google';

export interface StreetViewPanorama {
  id: string;
  source: StreetViewSource;
  lat: number;
  lng: number;
  /** Epoch seconds, when known. */
  capturedAt?: number;
  /** Compass heading of the camera, when known. */
  bearing?: number;
  /** True for 360° equirectangular panoramas (required by the 3D viewer). */
  isPano: boolean;
  /** Full-resolution equirectangular image URL. */
  imageUrl: string;
  thumbnailUrl?: string;
  /**
   * Tiled panorama levels (Google Street View), low → high quality. When
   * present the viewer stitches these instead of loading {@link imageUrl},
   * which is then only the flat fallback.
   */
  tiles?: StreetViewTileGrid[];
  attribution: string;
  license?: string;
  licenseUrl?: string;
  contributor?: string;
}

export interface StreetViewQuery {
  radiusDeg?: number;
  limit?: number;
  /** Force-disable Mapillary even when a token is configured (default: enabled). */
  includeMapillary?: boolean;
  /** Force-disable Google Street View (default: enabled). */
  includeGoogle?: boolean;
}

const DEFAULT_RADIUS_DEG = 0.004; // ~450 m
const DEFAULT_LIMIT = 20;
const FETCH_TIMEOUT_MS = 12_000;
/** Metres per degree of latitude, to translate the bbox radius to a search radius. */
const METERS_PER_DEGREE = 111_320;

export const PANORAMAX_ATTRIBUTION = 'Panoramax (CC-BY-SA)';
export const MAPILLARY_ATTRIBUTION = 'Mapillary (CC-BY-SA)';
export const GOOGLE_ATTRIBUTION = 'Google Street View (© Google)';

/** True when a Mapillary client token is configured. */
export function isMapillaryConfigured(): boolean {
  return MAPILLARY_TOKEN.trim().length > 0;
}

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function requestJson(url: string): Promise<unknown | null> {
  const { signal, cancel } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

// ── Panoramax (STAC GeoJSON) ────────────────────────────────────────

/**
 * Epoch seconds from a timestamp that may be epoch seconds or milliseconds.
 * Mapillary reports `captured_at` in milliseconds; Panoramax in seconds — this
 * normalizes both to the `StreetViewPanorama.capturedAt` contract.
 */
function toEpochSeconds(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value >= 1e12 ? value / 1000 : value);
}

/** Normalize a Panoramax STAC feature collection into panoramas. */
export function normalizePanoramax(payload: unknown): StreetViewPanorama[] {
  const features = (payload as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];

  const items: StreetViewPanorama[] = [];
  for (const feature of features) {
    const f = feature as {
      id?: string;
      geometry?: { coordinates?: [number, number] };
      assets?: Record<string, { href?: string }>;
      properties?: Record<string, unknown>;
    };
    const coords = f.geometry?.coordinates;
    const imageUrl = f.assets?.hd?.href ?? f.assets?.sd?.href;
    if (!coords || !imageUrl) continue;

    const datetime = f.properties?.datetime as string | undefined;
    const parsedMs = datetime ? Date.parse(datetime) : Number.NaN;
    const capturedAt = Number.isFinite(parsedMs) ? toEpochSeconds(parsedMs) : undefined;

    items.push({
      id: `panoramax:${f.id ?? `${coords[0]},${coords[1]}`}`,
      source: 'panoramax',
      lat: coords[1],
      lng: coords[0],
      capturedAt,
      isPano: true,
      imageUrl,
      thumbnailUrl: f.assets?.thumb?.href,
      attribution: PANORAMAX_ATTRIBUTION,
      license: (f.properties?.license as string) ?? 'CC-BY-SA-4.0',
      contributor: (f.properties?.author as string) ?? undefined,
    });
  }
  return items;
}

async function fetchPanoramax(
  lat: number,
  lng: number,
  radiusDeg: number,
): Promise<StreetViewPanorama[]> {
  const bbox = [lng - radiusDeg, lat - radiusDeg, lng + radiusDeg, lat + radiusDeg].join(',');
  const payload = await requestJson(`${PANORAMAX_SEARCH_URL}?bbox=${bbox}&limit=20`);
  if (!payload) return [];
  return normalizePanoramax(payload);
}

// ── Mapillary (Graph API) ───────────────────────────────────────────

interface MapillaryImage {
  id?: string;
  geometry?: { coordinates?: [number, number] };
  thumb_2048_url?: string;
  thumb_1024_url?: string;
  captured_at?: number;
  compass_angle?: number;
  is_pano?: boolean;
  creator?: { username?: string } | string;
}

/** Normalize a Mapillary `/images` response into panoramas. */
export function normalizeMapillary(payload: unknown): StreetViewPanorama[] {
  const data = (payload as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];

  const items: StreetViewPanorama[] = [];
  for (const entry of data) {
    const image = entry as MapillaryImage;
    const coords = image.geometry?.coordinates;
    const imageUrl = image.thumb_2048_url ?? image.thumb_1024_url;
    if (!image.id || !coords || !imageUrl) continue;

    const creator = typeof image.creator === 'string' ? image.creator : image.creator?.username;

    items.push({
      id: `mapillary:${image.id}`,
      source: 'mapillary',
      lat: coords[1],
      lng: coords[0],
      capturedAt: toEpochSeconds(image.captured_at),
      bearing: typeof image.compass_angle === 'number' ? image.compass_angle : undefined,
      isPano: image.is_pano === true,
      imageUrl,
      thumbnailUrl: image.thumb_1024_url,
      attribution: MAPILLARY_ATTRIBUTION,
      license: 'CC-BY-SA-4.0',
      licenseUrl: `https://www.mapillary.com/app/?focus=photo&pKey=${image.id}`,
      contributor: creator,
    });
  }
  return items;
}

async function fetchMapillary(
  lat: number,
  lng: number,
  radiusDeg: number,
): Promise<StreetViewPanorama[]> {
  if (!isMapillaryConfigured()) return [];
  const bbox = [lng - radiusDeg, lat - radiusDeg, lng + radiusDeg, lat + radiusDeg].join(',');
  const fields =
    'id,geometry,thumb_2048_url,thumb_1024_url,captured_at,compass_angle,is_pano,creator';
  const url =
    `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}` +
    `&fields=${fields}&bbox=${bbox}&limit=20`;
  const payload = await requestJson(url);
  if (!payload) return [];
  return normalizeMapillary(payload);
}

// ── Google Street View (streetlevel protocol) ───────────────────────

async function fetchGoogle(
  lat: number,
  lng: number,
  radiusDeg: number,
): Promise<StreetViewPanorama[]> {
  const radiusMeters = Math.max(50, Math.round(radiusDeg * METERS_PER_DEGREE));
  const pano = await findGoogleStreetViewPano(lat, lng, radiusMeters);
  if (!pano) return [];

  const tiles = buildTileGrids(pano);
  const panoid = pano.panoid;
  return [
    {
      id: `google:${panoid}`,
      source: 'google',
      lat: pano.lat,
      lng: pano.lng,
      capturedAt: pano.capturedAt,
      // Compass heading of the capture; passed to the viewer as the initial yaw
      // (same convention as Mapillary's compass_angle).
      bearing: pano.heading,
      // Google's official road coverage is always a 360° equirectangular pano.
      isPano: true,
      // Flat preview crop: the viewer's fallback, and the POI-card thumbnail.
      imageUrl: googleThumbnailUrl(panoid),
      thumbnailUrl: googleThumbnailUrl(panoid, { width: 400, height: 200 }),
      tiles: tiles.length > 0 ? tiles : undefined,
      attribution: pano.copyright ? `Google Street View (${pano.copyright})` : GOOGLE_ATTRIBUTION,
      licenseUrl: googlePermalink(pano),
    },
  ];
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Find nearby 360° panoramas from every configured source, deduped by id,
 * and capped. Google Street View panoramas come first (nearest first), then
 * Mapillary (nearest first), then the open Panoramax panoramas (most recently
 * captured first). Best-effort: a failing source contributes nothing. Only
 * panoramas (`isPano`) are returned for the 3D viewer.
 */
export async function findStreetViewPanoramas(
  lat: number,
  lng: number,
  query: StreetViewQuery = {},
): Promise<StreetViewPanorama[]> {
  const radiusDeg = query.radiusDeg ?? DEFAULT_RADIUS_DEG;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const includeMapillary = query.includeMapillary !== false;
  const includeGoogle = query.includeGoogle !== false;

  const [panoramax, mapillary, google] = await Promise.all([
    fetchPanoramax(lat, lng, radiusDeg),
    includeMapillary ? fetchMapillary(lat, lng, radiusDeg) : Promise.resolve([]),
    includeGoogle ? fetchGoogle(lat, lng, radiusDeg) : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const googlePanes: StreetViewPanorama[] = [];
  const mapillaryPanes: StreetViewPanorama[] = [];
  const panoramaxPanes: StreetViewPanorama[] = [];
  for (const item of google) {
    if (!item.isPano || seen.has(item.id)) continue;
    seen.add(item.id);
    googlePanes.push(item);
  }
  for (const item of mapillary) {
    if (!item.isPano || seen.has(item.id)) continue;
    seen.add(item.id);
    mapillaryPanes.push(item);
  }
  for (const item of panoramax) {
    if (!item.isPano || seen.has(item.id)) continue;
    seen.add(item.id);
    panoramaxPanes.push(item);
  }

  const distanceFromCenter = (p: StreetViewPanorama) => haversineMeters([lng, lat], [p.lng, p.lat]);

  googlePanes.sort((a, b) => distanceFromCenter(a) - distanceFromCenter(b));
  mapillaryPanes.sort((a, b) => distanceFromCenter(a) - distanceFromCenter(b));
  // Most recently captured first; undated panoramas sort last.
  panoramaxPanes.sort((a, b) => (b.capturedAt ?? -Infinity) - (a.capturedAt ?? -Infinity));

  return [...googlePanes, ...mapillaryPanes, ...panoramaxPanes].slice(0, limit);
}

/**
 * Order panoramas newest-first across every source, independent of how the
 * lookup ranked them. Undated captures sort last. The stable sort keeps the
 * lookup's relative order for equal dates, so the leading capture stays
 * meaningful. Used by the timeline viewer, which opens on the most recent
 * capture regardless of source.
 */
export function sortPanoramasByRecency(panoramas: StreetViewPanorama[]): StreetViewPanorama[] {
  return [...panoramas].sort((a, b) => (b.capturedAt ?? -Infinity) - (a.capturedAt ?? -Infinity));
}
