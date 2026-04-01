import type { OsmPoi } from '../services/poi/osmFetcher';

export interface ViewportBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/**
 * Zoom-adaptive cap on total displayed POI pills.
 * At street level (zoom ≥ 17) we allow up to 200 pills since the viewport
 * covers a small area and users expect to see every nearby business —
 * matching the density shown by Overture Maps Explorer.
 */
function maxTotalForZoom(zoom: number): number {
  if (zoom >= 17) return 200;
  if (zoom >= 16) return 160;
  if (zoom >= 15) return 120;
  return 80;
}

/**
 * Convert a (lat, lng) coordinate to absolute Web Mercator pixel coordinates
 * at the given MapLibre zoom level. Large absolute values, but differences
 * between two results give accurate screen-pixel distances.
 */
function toPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Approximate pill dimensions in screen pixels (icon + average-length label
 * + padding). At high zoom, tighten spacing so more POIs fit on screen.
 */
const PILL_W = 120; // typical rendered width
const PILL_H = 28; // rendered height

function exclusionGaps(zoom: number): { gapX: number; gapY: number } {
  // At zoom ≥ 17 (street level), shrink gaps to ~60% of default so dense
  // shopping centres render all storefronts. Scale linearly between z15–z17.
  const t = Math.min(1, Math.max(0, (zoom - 15) / 2)); // 0 at z15, 1 at z17+
  const scale = 1 - t * 0.4; // 1.0 → 0.6
  return {
    gapX: (PILL_W + 8) * scale,
    gapY: (PILL_H + 6) * scale,
  };
}

/** Returns true if (cx, cy) falls within the exclusion zone of any placed pill. */
function overlaps(
  cx: number,
  cy: number,
  placed: Array<{ x: number; y: number }>,
  gapX: number,
  gapY: number,
): boolean {
  for (const p of placed) {
    if (Math.abs(cx - p.x) < gapX && Math.abs(cy - p.y) < gapY) return true;
  }
  return false;
}

/**
 * Filters a raw POI list down to a non-overlapping, category-diverse subset
 * suitable for display as pill badges on the map.
 *
 * Algorithm:
 *  1. Convert every POI's lat/lng to absolute Mercator pixel coordinates.
 *  2. Group by subtype and interleave (round-robin) to build a diversity-first
 *     candidate order — so different category types appear before duplicates.
 *  3. Greedily select: skip any candidate whose pill bounding box overlaps an
 *     already-placed one.
 *  4. Stop at MAX_TOTAL.
 *
 * The pixel exclusion zone is naturally zoom-aware: at low zoom each pill
 * covers a much larger geographic area so fewer can fit; at street level
 * dense co-located businesses appear without overlap.
 */
export function filterPoisForDisplay(
  pois: OsmPoi[],
  bounds: ViewportBounds,
  zoom: number,
): OsmPoi[] {
  if (pois.length === 0) return [];

  // -- 1. Compute pixel positions -------------------------------------------
  type Entry = { poi: OsmPoi; x: number; y: number };
  const entries: Entry[] = pois.map((poi) => {
    const { x, y } = toPixel(poi.lat, poi.lng, zoom);
    return { poi, x, y };
  });

  // -- 2. Round-robin diversity ordering ------------------------------------
  // Group by subtype so we interleave categories: restaurant, cafe, pharmacy,
  // restaurant (2nd), cafe (2nd), … rather than all restaurants first.
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = `${e.poi.type}/${e.poi.subtype}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const groupArrays = [...groups.values()];
  const maxLen = Math.max(...groupArrays.map((g) => g.length));
  const candidates: Entry[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const g of groupArrays) {
      if (i < g.length) candidates.push(g[i]);
    }
  }

  // -- 3. Greedy pixel-exclusion selection ----------------------------------
  const placed: Array<{ x: number; y: number }> = [];
  const result: OsmPoi[] = [];
  const maxTotal = maxTotalForZoom(zoom);
  const { gapX, gapY } = exclusionGaps(zoom);

  for (const { poi, x, y } of candidates) {
    if (result.length >= maxTotal) break;
    if (overlaps(x, y, placed, gapX, gapY)) continue;
    placed.push({ x, y });
    result.push(poi);
  }

  return result;
}
