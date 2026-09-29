/**
 * Tile fallback chains for MapLibre raster sources.
 *
 * A MapLibre raster source may list several tile URL templates. MapLibre
 * requests the first and only falls through to the next when a tile errors
 * (404 / network failure), so appending a global fallback costs nothing while
 * the primary succeeds, and prevents black gaps when a provider is missing a
 * tile or briefly down.
 *
 * This is the native-safe half of the routing engine's "graceful degradation":
 * it needs no custom URL protocol (which MapLibre Native does not support).
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

/**
 * Append one or more global fallback templates to a provider's templates.
 *
 * The global fallback (e.g. Sentinel-2) covers everywhere, so a provider tile
 * that 404s inside its own bounds degrades to global imagery instead of a gap.
 */
export function withGlobalFallback(providerTiles: string[], globalTiles: string[]): string[] {
  return withFallbackTiles(providerTiles, globalTiles);
}
