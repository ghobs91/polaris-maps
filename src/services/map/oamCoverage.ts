/**
 * OpenAerialMap viewport coverage.
 *
 * OAM has no fixed footprint — its registry entry is global — so the tile
 * router cannot decide whether to mount it. The static satellite style
 * deliberately omits OAM (a global layer would 404 worldwide). This queries the
 * OAM STAC search for the viewport and returns the union of the footprints it
 * finds, so runtime imagery only layers OAM where HOT has contributed it.
 */

import type { RegionalOrthophotoSource } from '../../constants/orthophotoSources';
import { OAM_STAC_SEARCH_URL, GLOBAL_IMAGERY_SOURCES } from './imagerySources';
import { createTileMetadataCache, type BBox } from './tileRouter';

interface OamFeature {
  bbox?: unknown;
}

const coverageCache = createTileMetadataCache<BBox | null>({ ttlMs: 300_000, max: 200 });

/**
 * Below this zoom the OAM mosaic is too patchy to layer over the global base
 * (its footprints are sparse, so it reads as random sharp patches). The runtime
 * manager only mounts OAM at or above it.
 */
export const OAM_MIN_ZOOM = 10;

/** Round a coordinate to ~1 km so small pans reuse the same cache entry. */
function cacheKey(bbox: BBox): string {
  return bbox.map((value) => Math.round(value * 100) / 100).join(',');
}

/** A finite, ordered `[west, south, east, north]` bbox, or null. */
function normalizeBBox(value: unknown): BBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [w, s, e, n] = value as unknown[];
  if (![w, s, e, n].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return [
    Math.min(w as number, e as number),
    Math.min(s as number, n as number),
    Math.max(w as number, e as number),
    Math.max(s as number, n as number),
  ];
}

/** Overlap of two bboxes, or null when they do not intersect. */
export function intersectBBox(a: BBox, b: BBox): BBox | null {
  const [aw, as, ae, an] = a;
  const [bw, bs, be, bn] = b;
  const west = Math.max(aw, bw);
  const south = Math.max(as, bs);
  const east = Math.min(ae, be);
  const north = Math.min(an, bn);
  return west <= east && south <= north ? [west, south, east, north] : null;
}

function unionBBox(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export interface FindOamCoverageOptions {
  /** Injectable fetch for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Bbox for which OAM has contributed imagery inside `bbox` (the union of the
 * intersecting STAC footprints, clipped to `bbox`), or `null` when there is
 * none — or the lookup fails. Successful results are cached for 5 minutes;
 * failures are not cached so a transient error does not hide coverage.
 */
export async function findOamCoverage(
  bbox: BBox,
  options: FindOamCoverageOptions = {},
): Promise<BBox | null> {
  const key = cacheKey(bbox);
  if (coverageCache.has(key)) return coverageCache.get(key) ?? null;

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${OAM_STAC_SEARCH_URL}?bbox=${bbox.join(',')}&limit=50`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const body = (await response.json()) as { features?: OamFeature[] };
    let union: BBox | null = null;
    for (const feature of body.features ?? []) {
      const footprint = normalizeBBox(feature?.bbox);
      if (!footprint) continue;
      const clipped = intersectBBox(footprint, bbox);
      if (!clipped) continue;
      union = union ? unionBBox(union, clipped) : clipped;
    }
    coverageCache.set(key, union);
    return union;
  } catch {
    return null;
  }
}

function oamRegistryEntry(): (typeof GLOBAL_IMAGERY_SOURCES)[number] {
  const entry = GLOBAL_IMAGERY_SOURCES.find((source) => source.id === 'oam');
  if (!entry) throw new Error('OpenAerialMap registry entry is missing');
  return entry;
}

/**
 * The OpenAerialMap mosaic as a bounded regional-style overlay for the given
 * coverage, so `buildSatelliteStyleJson` can layer it like any other provider.
 */
export function oamOverlaySource(coverage: BBox): RegionalOrthophotoSource {
  const oam = oamRegistryEntry();
  return {
    id: oam.id,
    label: oam.label,
    tiles: oam.tiles,
    tileSize: oam.tileSize,
    minzoom: oam.minzoom,
    maxzoom: oam.maxzoom,
    resolutionM: oam.resolutionM,
    acquiredAt: oam.acquiredAt,
    attribution: oam.attribution,
    bounds: coverage,
  };
}
