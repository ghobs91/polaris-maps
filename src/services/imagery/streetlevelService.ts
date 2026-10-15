/**
 * Google Street View lookup over Google's internal ("streetlevel") endpoints.
 *
 * The request/response shapes here were mapped from the `sk-zk/streetlevel`
 * project (https://github.com/sk-zk/streetlevel, MIT), which documents how to
 * reach the imagery without an API key. This is an independent TypeScript
 * implementation of the same public-facing requests — no streetlevel code is
 * bundled or executed (that library is Python).
 *
 * The endpoints are undocumented and can change without notice, so every parse
 * is defensive: an unexpected shape yields `null` and the caller falls back to
 * the other street-view sources.
 */

import {
  STREETLEVEL_PANO_SEARCH_URL,
  STREETLEVEL_THUMBNAIL_BASE_URL,
  STREETLEVEL_TILE_BASE_URL,
  STREETLEVEL_USER_AGENT,
} from '../../constants/config';

export interface GoogleStreetViewPano {
  panoid: string;
  lat: number;
  lng: number;
  /** Compass heading of the capture in degrees (0 = north). */
  heading?: number;
  /** Epoch seconds; official coverage only exposes year/month. */
  capturedAt?: number;
  /** Copyright line as displayed on Google Maps, e.g. "© 2026 Google". */
  copyright?: string;
  /** Ascending image sizes (index = zoom level). */
  imageSizes: Array<{ width: number; height: number }>;
  /** Single tile size in pixels (usually 512×512). */
  tileSize: number;
}

/** One stitched image level of a tiled panorama. */
export interface StreetViewTileGrid {
  /** Tile URL with `{x}`, `{y}` and `{z}` placeholders. */
  urlTemplate: string;
  cols: number;
  rows: number;
  tileSize: number;
  zoom: number;
  /** Full stitched size in pixels (may not be an exact tile multiple). */
  width: number;
  height: number;
}

const FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_TILE_SIZE = 512;

/** Quick first paint: 2048×1024 → 8 tiles. */
export const PREVIEW_GOOGLE_STREETVIEW_ZOOM = 2;
/** Full quality: 4096×2048 → 32 tiles (the largest level we stitch by default). */
export const DEFAULT_GOOGLE_STREETVIEW_ZOOM = 3;

// ── Defensive accessors for the nested-array ("JSON protobuf") payload ──

function at(node: unknown, ...indices: number[]): unknown {
  let current: unknown = node;
  for (const index of indices) {
    if (!Array.isArray(current)) return undefined;
    current = current[index];
  }
  return current;
}

function num(node: unknown, ...indices: number[]): number | undefined {
  const value = at(node, ...indices);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(node: unknown, ...indices: number[]): string | undefined {
  const value = at(node, ...indices);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `[height, width]` pairs, ascending by zoom level. */
function parseImageSizes(raw: unknown): Array<{ width: number; height: number }> {
  if (!Array.isArray(raw)) return [];
  const sizes: Array<{ width: number; height: number }> = [];
  for (const entry of raw) {
    const pair = at(entry, 0);
    if (!Array.isArray(pair)) continue;
    const height = pair[0];
    const width = pair[1];
    if (typeof width !== 'number' || typeof height !== 'number') continue;
    if (width <= 0 || height <= 0) continue;
    sizes.push({ width, height });
  }
  return sizes;
}

/** Official coverage exposes `[year, month]`; day (if present) defaults to the 1st. */
function parseCaptureDate(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  const [year, month, day] = raw;
  if (typeof year !== 'number' || typeof month !== 'number') return undefined;
  const safeDay = typeof day === 'number' ? day : 1;
  const ms = Date.UTC(year, month - 1, safeDay);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/** Strip an optional XSSI prefix (`)]}'`) and parse; `null` on any failure. */
export function parseGoogleSearchResponse(text: string): unknown {
  const cleaned = text.replace(/^\)\]\}'\s*/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
}

/**
 * Normalize a `SingleImageSearch` response into a panorama, or `null` when the
 * response reports no imagery (status 5) or is missing required fields.
 */
export function normalizeGoogleStreetView(payload: unknown): GoogleStreetViewPano | null {
  const status = num(payload, 0, 0);
  if (status !== 0) return null; // 5 = no imagery within the radius

  const message = at(payload, 1);
  const panoid = str(message, 1, 1);
  const lat = num(message, 5, 0, 1, 0, 2);
  const lng = num(message, 5, 0, 1, 0, 3);
  const imageSizes = parseImageSizes(at(message, 2, 3, 0));
  if (!panoid || lat === undefined || lng === undefined || imageSizes.length === 0) return null;

  const tileSize = num(message, 2, 3, 1, 0) ?? DEFAULT_TILE_SIZE;

  return {
    panoid,
    lat,
    lng,
    heading: num(message, 5, 0, 1, 2, 0),
    capturedAt: parseCaptureDate(at(message, 6, 7)),
    copyright: str(message, 4, 0, 0, 0, 0),
    imageSizes,
    tileSize: tileSize > 0 ? tileSize : DEFAULT_TILE_SIZE,
  };
}

/** `SingleImageSearch` body: a JSON-encoded protobuf-ish request. */
export function buildGoogleSearchBody(
  lat: number,
  lng: number,
  radiusMeters = 50,
  locale = 'en',
): string {
  const parts = locale.split('-');
  const lang = parts[0] || 'en';
  const country = parts[1] ?? lang;
  return JSON.stringify([
    ['apiv3', null, null, null, 'US'],
    [[null, null, lat, lng], Math.round(radiusMeters)],
    [null, [lang, country], null, null, null, null, null, null, [2], null, [[[2, true, 2]]]],
    [[1, 2, 3, 4, 6, 8, 12], null, null, null, [], []],
  ]);
}

// ── URL builders ────────────────────────────────────────────────────

/** Tile URL template with `{x}`, `{y}` (tile coords) and `{z}` (zoom level). */
export function googleTileUrlTemplate(panoid: string): string {
  return (
    `${STREETLEVEL_TILE_BASE_URL}?cb_client=maps_sv.tactile` +
    `&panoid=${encodeURIComponent(panoid)}&x={x}&y={y}&zoom={z}`
  );
}

/** Flat preview crop (also used as the thumbnail and viewer fallback). */
export function googleThumbnailUrl(
  panoid: string,
  options: { width?: number; height?: number; yaw?: number; pitch?: number; fov?: number } = {},
): string {
  const { width = 900, height = 450, yaw = 0, pitch = 0, fov = 100 } = options;
  return (
    `${STREETLEVEL_THUMBNAIL_BASE_URL}?cb_client=maps_sv.tactile` +
    `&panoid=${encodeURIComponent(panoid)}&w=${width}&h=${height}` +
    `&yaw=${yaw}&pitch=${pitch}&thumbfov=${fov}`
  );
}

/** Link to the panorama on Google Maps, used for attribution. */
export function googlePermalink(
  pano: Pick<GoogleStreetViewPano, 'panoid' | 'lat' | 'lng' | 'heading'>,
): string {
  const heading = pano.heading ?? 0;
  return (
    `https://www.google.com/maps/@${pano.lat},${pano.lng},3a,75y,${heading}h,90t` +
    `/data=!3m4!1e1!3m2!1s${encodeURIComponent(pano.panoid)}!2e2`
  );
}

function clampZoom(zoom: number, levelCount: number): number {
  return Math.max(0, Math.min(Math.round(zoom), levelCount - 1));
}

/**
 * Build the stitched image levels for a panorama, low quality → high quality.
 * Requested zooms are clamped to the levels the panorama actually provides and
 * de-duplicated so the viewer can load them progressively.
 */
export function buildTileGrids(
  pano: Pick<GoogleStreetViewPano, 'panoid' | 'imageSizes' | 'tileSize'>,
  zoomLevels: number[] = [PREVIEW_GOOGLE_STREETVIEW_ZOOM, DEFAULT_GOOGLE_STREETVIEW_ZOOM],
): StreetViewTileGrid[] {
  const grids: StreetViewTileGrid[] = [];
  if (pano.imageSizes.length === 0) return grids;
  const seen = new Set<number>();
  for (const requested of zoomLevels) {
    const zoom = clampZoom(requested, pano.imageSizes.length);
    if (seen.has(zoom)) continue;
    const size = pano.imageSizes[zoom];
    const tileSize = pano.tileSize > 0 ? pano.tileSize : DEFAULT_TILE_SIZE;
    grids.push({
      urlTemplate: googleTileUrlTemplate(pano.panoid),
      cols: Math.max(1, Math.ceil(size.width / tileSize)),
      rows: Math.max(1, Math.ceil(size.height / tileSize)),
      tileSize,
      zoom,
      width: size.width,
      height: size.height,
    });
    seen.add(zoom);
  }
  return grids;
}

// ── Lookup ──────────────────────────────────────────────────────────

/**
 * Find the nearest official Street View panorama to a point. Best-effort:
 * returns `null` on no coverage, network failure, timeout, or an unexpected
 * response shape.
 */
export async function findGoogleStreetViewPano(
  lat: number,
  lng: number,
  radiusMeters = 50,
): Promise<GoogleStreetViewPano | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(STREETLEVEL_PANO_SEARCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json+protobuf',
        Accept: '*/*',
        'User-Agent': STREETLEVEL_USER_AGENT,
      },
      body: buildGoogleSearchBody(lat, lng, radiusMeters),
    });
    if (!response.ok) return null;
    return normalizeGoogleStreetView(parseGoogleSearchResponse(await response.text()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
