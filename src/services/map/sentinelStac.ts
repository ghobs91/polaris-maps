/**
 * Latest Sentinel-2 scene discovery for the viewport.
 *
 * The satellite base is the static EOx Sentinel-2 *cloudless* mosaic, so there
 * is no per-scene imagery to render dynamically. What the STAC primitives are
 * wired to is freshness: the app reports how recent the newest Sentinel-2 L2A
 * acquisition over the viewport is (surfaced in the map attribution panel).
 *
 * Uses the AWS Element 84 Earth Search STAC API. Best-effort and cached; a
 * failure never affects rendering.
 */

import { createTileMetadataCache, type BBox } from './tileRouter';

export const SENTINEL_STAC_SEARCH_URL =
  'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items';

/** Cloud cover above which a scene is not considered a usable "latest" view. */
export const SENTINEL_MAX_CLOUD_COVER = 40;

export interface SentinelScene {
  id: string;
  /** ISO acquisition timestamp. */
  datetime: string;
  /** `eo:cloud_cover` percentage, when the STAC item reports it. */
  cloudCover: number | null;
}

const sceneCache = createTileMetadataCache<SentinelScene | null>({
  ttlMs: 1_800_000,
  max: 100,
});

function cacheKey(bbox: BBox): string {
  return bbox.map((value) => Math.round(value * 100) / 100).join(',');
}

interface StacFeature {
  id?: unknown;
  properties?: {
    datetime?: unknown;
    start_datetime?: unknown;
    'eo:cloud_cover'?: unknown;
  };
}

export interface FindSentinelSceneOptions {
  /** Injectable fetch for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function toScene(feature: StacFeature): SentinelScene | null {
  const id = typeof feature.id === 'string' ? feature.id : null;
  const raw = feature.properties?.datetime ?? feature.properties?.start_datetime;
  const datetime = typeof raw === 'string' ? raw : null;
  if (!id || !datetime || Number.isNaN(Date.parse(datetime))) return null;
  const cloud = feature.properties?.['eo:cloud_cover'];
  return { id, datetime, cloudCover: typeof cloud === 'number' ? cloud : null };
}

/**
 * Freshest Sentinel-2 L2A scene intersecting `bbox` (preferring one under
 * `SENTINEL_MAX_CLOUD_COVER`), or `null` when the lookup fails or finds
 * nothing. Successful results — including "nothing found" — are cached for 30
 * minutes; failures are not, so a transient error does not hide scenes.
 */
export async function findLatestSentinelScene(
  bbox: BBox,
  options: FindSentinelSceneOptions = {},
): Promise<SentinelScene | null> {
  const key = cacheKey(bbox);
  if (sceneCache.has(key)) return sceneCache.get(key) ?? null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    bbox: bbox.join(','),
    limit: '20',
    query: JSON.stringify({ 'eo:cloud_cover': { lt: SENTINEL_MAX_CLOUD_COVER } }),
  });
  try {
    const response = await fetchImpl(`${SENTINEL_STAC_SEARCH_URL}?${params.toString()}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { features?: StacFeature[] };
    const scenes = (body.features ?? [])
      .map(toScene)
      .filter((scene): scene is SentinelScene => scene !== null)
      .sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime));
    const scene = scenes[0] ?? null;
    sceneCache.set(key, scene);
    return scene;
  } catch {
    return null;
  }
}
