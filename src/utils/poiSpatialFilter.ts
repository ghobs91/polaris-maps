import type { OsmPoi } from '../services/poi/osmFetcher';

export interface ViewportBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

// Keep street-level rendering aligned with the Overture fetch threshold in
// MapView so dense storefront POIs are not fetched at z17 and then thinned out
// by the pre-street-level display path until z17.25.
export const STREET_LEVEL_POI_ZOOM = 17;

/**
 * Zoom-adaptive cap on total displayed POI markers.
 * At street level (zoom ≥ 17) we allow up to 420 markers since the compact
 * icon+label design takes much less space than the previous pill style.
 */
function maxTotalForZoom(zoom: number): number {
  if (zoom >= 17) return 420;
  if (zoom >= 16) return 400;
  if (zoom >= 15) return 300;
  if (zoom >= 14) return 180;
  return 100;
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
 * Approximate marker dimensions in screen pixels.
 * `MARKER_*` covers the icon footprint; `LABEL_*` tracks the actual truncated
 * text footprint used in POILayer so label filtering matches what users see.
 */
const MARKER_W = 24;
const MARKER_H = 24;
const LABEL_W = 104;
const LABEL_H = 30;

const METERS_PER_DEG_LAT = 111_320;

function viewportMargin(bounds: ViewportBounds): { lat: number; lng: number } {
  return {
    lat: Math.max(0.00015, (bounds.maxLat - bounds.minLat) * 0.08),
    lng: Math.max(0.00015, (bounds.maxLng - bounds.minLng) * 0.08),
  };
}

function isWithinViewport(poi: OsmPoi, bounds: ViewportBounds): boolean {
  const margin = viewportMargin(bounds);
  return (
    poi.lat >= bounds.minLat - margin.lat &&
    poi.lat <= bounds.maxLat + margin.lat &&
    poi.lng >= bounds.minLng - margin.lng &&
    poi.lng <= bounds.maxLng + margin.lng
  );
}

function toLocalMeters(lat: number, lng: number, refLat: number): { x: number; y: number } {
  const metersPerDegLng = Math.max(1, METERS_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180));
  return {
    x: lng * metersPerDegLng,
    y: lat * METERS_PER_DEG_LAT,
  };
}

function streetLevelBuildingGapMeters(zoom: number): number {
  if (zoom >= 19) return 8;
  if (zoom >= 18) return 11;
  if (zoom >= STREET_LEVEL_POI_ZOOM) return 14;
  return 18;
}

function exclusionGaps(zoom: number): { gapX: number; gapY: number } {
  if (zoom >= STREET_LEVEL_POI_ZOOM) {
    return {
      gapX: 12,
      gapY: 10,
    };
  }
  // At zoom ≥ 17 (street level), shrink gaps to ~35% of default so dense
  // shopping centres render all storefronts. Scale linearly between z14–z17.
  const t = Math.min(1, Math.max(0, (zoom - 14) / 3)); // 0 at z14, 1 at z17+
  const scale = 1 - t * 0.65; // 1.0 → 0.35
  return {
    gapX: (LABEL_W + 4) * scale,
    gapY: (LABEL_H + 3) * scale,
  };
}

function labelExclusionGaps(zoom: number): { gapX: number; gapY: number } {
  if (zoom >= 19) {
    return { gapX: 58, gapY: 18 };
  }
  if (zoom >= 18) {
    return { gapX: 72, gapY: 22 };
  }
  if (zoom >= STREET_LEVEL_POI_ZOOM) {
    return { gapX: 86, gapY: 24 };
  }

  const { gapX, gapY } = exclusionGaps(zoom);
  return {
    gapX: Math.max(gapX, 32),
    gapY: Math.max(gapY, 16),
  };
}

/**
 * Grid-based spatial index for O(1) amortised overlap checks.
 * Cells are sized to the exclusion gap so only a 3×3 neighbourhood
 * needs to be inspected per candidate.
 */
class PlacementGrid {
  private cells = new Map<number, Array<{ x: number; y: number }>>();

  constructor(
    private cellW: number,
    private cellH: number,
  ) {}

  private key(cx: number, cy: number): number {
    // Cantor-style pairing — avoids string allocation per lookup
    const a = cx >= 0 ? 2 * cx : -2 * cx - 1;
    const b = cy >= 0 ? 2 * cy : -2 * cy - 1;
    return ((a + b) * (a + b + 1)) / 2 + b;
  }

  insert(x: number, y: number): void {
    const cx = Math.floor(x / this.cellW);
    const cy = Math.floor(y / this.cellH);
    const k = this.key(cx, cy);
    const cell = this.cells.get(k);
    if (cell) cell.push({ x, y });
    else this.cells.set(k, [{ x, y }]);
  }

  hasOverlap(x: number, y: number, gapX: number, gapY: number): boolean {
    const cx = Math.floor(x / this.cellW);
    const cy = Math.floor(y / this.cellH);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(this.key(cx + dx, cy + dy));
        if (!cell) continue;
        for (const p of cell) {
          if (Math.abs(x - p.x) < gapX && Math.abs(y - p.y) < gapY) return true;
        }
      }
    }
    return false;
  }
}

function selectStreetLevelCandidates(
  entries: Array<{ poi: OsmPoi; x: number; y: number }>,
  bounds: ViewportBounds,
  zoom: number,
): Array<{ poi: OsmPoi; x: number; y: number }> {
  const refLat = (bounds.minLat + bounds.maxLat) / 2;
  const buildingGapMeters = streetLevelBuildingGapMeters(zoom);
  const buildingGrid = new PlacementGrid(buildingGapMeters, buildingGapMeters);
  const selected: Array<{ poi: OsmPoi; x: number; y: number }> = [];

  for (const entry of entries) {
    const { x: meterX, y: meterY } = toLocalMeters(entry.poi.lat, entry.poi.lng, refLat);
    if (buildingGrid.hasOverlap(meterX, meterY, buildingGapMeters, buildingGapMeters)) continue;
    buildingGrid.insert(meterX, meterY);
    selected.push(entry);
  }

  return selected;
}

/**
 * Filters a raw POI list down to a non-overlapping, category-diverse subset
 * suitable for display as icon+label markers on the map.
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

  // POI fetching may use padded bounds to keep nearby businesses warm in the
  // cache, but display selection must only consider the actual visible viewport
  // (plus a tiny margin for edge markers). Otherwise off-screen POIs consume
  // street-level slots and visible storefronts disappear.
  const viewportPois = pois.filter((poi) => isWithinViewport(poi, bounds));
  if (viewportPois.length === 0) return [];

  // -- 1. Compute pixel positions -------------------------------------------
  type Entry = { poi: OsmPoi; x: number; y: number };
  const entries: Entry[] = viewportPois.map((poi) => {
    const { x, y } = toPixel(poi.lat, poi.lng, zoom);
    return { poi, x, y };
  });

  // -- 2. Candidate ordering -------------------------------------------------
  let candidates: Entry[];
  if (zoom >= STREET_LEVEL_POI_ZOOM) {
    // At street level, Google/Apple-style rendering favours local completeness
    // over viewport-wide category diversity. Collapse only near-identical
    // storefront coordinates so adjacent buildings can all remain visible.
    candidates = selectStreetLevelCandidates(entries, bounds, zoom);
  } else {
    // Group by subtype so we interleave categories: restaurant, cafe,
    // pharmacy, restaurant (2nd), cafe (2nd), … rather than all restaurants
    // first.
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      const key = `${entry.poi.type}/${entry.poi.subtype}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const groupArrays = [...groups.values()];
    const maxLen = Math.max(...groupArrays.map((g) => g.length));
    candidates = [];
    for (let i = 0; i < maxLen; i++) {
      for (const g of groupArrays) {
        if (i < g.length) candidates.push(g[i]);
      }
    }
  }

  // -- 3. Greedy pixel-exclusion selection (grid-accelerated) ---------------
  const maxTotal = maxTotalForZoom(zoom);
  const { gapX, gapY } = exclusionGaps(zoom);
  const grid = new PlacementGrid(gapX, gapY);
  const result: OsmPoi[] = [];

  for (const { poi, x, y } of candidates) {
    if (result.length >= maxTotal) break;
    if (grid.hasOverlap(x, y, gapX, gapY)) continue;
    grid.insert(x, y);
    result.push(poi);
  }

  return result;
}

/**
 * Selects the subset of already-visible POIs that should render text labels.
 * Icons can remain denser, but labels need a much wider exclusion zone to
 * avoid unreadable collisions in strip malls and downtown blocks.
 */
export function filterPoiLabelsForDisplay(
  pois: OsmPoi[],
  bounds: ViewportBounds,
  zoom: number,
): OsmPoi[] {
  if (pois.length === 0) return [];

  const entries = pois
    .filter((poi) => isWithinViewport(poi, bounds))
    .map((poi) => ({
      poi,
      ...toPixel(poi.lat, poi.lng, zoom),
    }));
  if (entries.length === 0) return [];

  const { gapX, gapY } = labelExclusionGaps(zoom);
  const grid = new PlacementGrid(gapX, gapY);
  const result: OsmPoi[] = [];

  for (const { poi, x, y } of entries) {
    if (grid.hasOverlap(x, y, gapX, gapY)) continue;
    grid.insert(x, y);
    result.push(poi);
  }

  return result;
}
