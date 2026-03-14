import type { OsmPoi } from '../services/poi/osmFetcher';

export interface ViewportBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Grid dimensions — viewport is divided into COLS × ROWS cells */
const COLS = 6;
const ROWS = 8;

/** Hard cap on total displayed POI badges */
const MAX_TOTAL = 35;

/** Max POI badges per grid cell, scaled by zoom */
function cellLimit(zoom: number): number {
  if (zoom >= 17) return 3;
  if (zoom >= 16) return 2;
  return 1;
}

/**
 * Filters a raw OSM POI list to an evenly distributed, category-diverse
 * subset suitable for display as map badges.
 *
 * Algorithm:
 *  1. Overlay a COLS×ROWS grid on the viewport bounding box.
 *  2. Bucket each POI into its grid cell.
 *  3. For each cell pick at most cellLimit(zoom) POIs, preferring subtypes
 *     not already chosen elsewhere in the viewport.
 *  4. Cap the total at MAX_TOTAL.
 *
 * Result: spatially spread markers from diverse categories with no
 * artificially dense clusters.
 */
export function filterPoisForDisplay(
  pois: OsmPoi[],
  bounds: ViewportBounds,
  zoom: number,
): OsmPoi[] {
  if (pois.length === 0) return [];

  const latRange = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const limit = cellLimit(zoom);

  // -- 1. Bucket POIs into grid cells -----------------------------------------
  const grid = new Map<string, OsmPoi[]>();
  for (const poi of pois) {
    const col = Math.max(
      0,
      Math.min(COLS - 1, Math.floor(((poi.lng - bounds.minLng) / lngRange) * COLS)),
    );
    const row = Math.max(
      0,
      Math.min(ROWS - 1, Math.floor(((poi.lat - bounds.minLat) / latRange) * ROWS)),
    );
    const key = `${col},${row}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(poi);
  }

  // -- 2. Select diverse POIs per cell ----------------------------------------
  const selected: OsmPoi[] = [];
  // Tracks subtypes already chosen globally — used to prefer novel categories
  const globalUsedSubtypes = new Set<string>();

  for (const cellPois of grid.values()) {
    if (selected.length >= MAX_TOTAL) break;

    // Sort cell POIs: novel subtypes (not yet picked globally) come first
    const sorted = [...cellPois].sort((a, b) => {
      const aScore = globalUsedSubtypes.has(`${a.type}/${a.subtype}`) ? 1 : 0;
      const bScore = globalUsedSubtypes.has(`${b.type}/${b.subtype}`) ? 1 : 0;
      return aScore - bScore;
    });

    // Pick up to `limit` POIs from this cell, one per subtype
    const cellSubtypes = new Set<string>();
    for (const poi of sorted) {
      if (selected.length >= MAX_TOTAL) break;
      if (cellSubtypes.size >= limit) break;
      const sk = `${poi.type}/${poi.subtype}`;
      if (!cellSubtypes.has(sk)) {
        selected.push(poi);
        cellSubtypes.add(sk);
        globalUsedSubtypes.add(sk);
      }
    }
  }

  return selected;
}
