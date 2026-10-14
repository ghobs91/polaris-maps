/**
 * Tile fallback chains for MapLibre raster sources.
 *
 * A MapLibre raster source may list several tile URL templates. MapLibre
 * requests the first and only falls through to the next when a tile errors
 * (404 / network failure), so an ordered chain is the native-safe way to list
 * alternative endpoints for one source.
 *
 * The satellite imagery stack does NOT append a coarser global fallback to
 * finer providers: a failed fine tile should fall through to the layers beneath
 * (MapLibre leaves it empty), and painting a coarse fallback on top would
 * defeat resolution priority. The global base keeps its own same-class outage
 * fallback (EOx → Landsat).
 *
 * This needs no custom URL protocol (which MapLibre Native does not support).
 * Timeout-based switching is not expressible in a style and would need a proxy.
 */

import { rankImagerySources, type BBox, type ImagerySource, type RankOptions } from './tileRouter';

/**
 * Concatenate tile URL templates in priority order, dropping duplicates.
 * The first URL is the primary; later URLs are fallbacks.
 */
export function withFallbackTiles(primary: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...primary, ...fallback]) {
    if (typeof url !== 'string' || url.length === 0) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Ordered tile URL templates for a viewport, best source first, from the
 * router's ranking. Useful for building a fallback chain dynamically.
 */
export function rankedFallbackTileUrls(
  bbox: BBox,
  zoom: number,
  sources: ImagerySource[],
  options: RankOptions = {},
): string[] {
  const ranked = rankImagerySources(bbox, zoom, sources, options);
  return withFallbackTiles(
    ranked.flatMap((source) => source.tiles),
    [],
  );
}
