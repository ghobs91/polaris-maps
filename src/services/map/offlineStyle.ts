/**
 * Offline style rewriting for downloaded region packs.
 *
 * Region packs store OpenMapTiles vector tiles as `{z}/{x}/{y}.pbf` (z0–12)
 * under `regions/{id}/tiles/`, served over loopback HTTP by the native
 * `PolarisTileServer` (see `offlineMapService`). This module rewrites a
 * serialised MapLibre style JSON so its vector sources point at that local
 * server instead of `https://tiles.openfreemap.org`.
 *
 * Pure JSON in/out — no native or Expo imports, so it stays unit-testable.
 */

/** Downloaded packs contain zooms 0–12; MapLibre overzooms z13+ from z12. */
export const OFFLINE_PACK_MAXZOOM = 12;

export interface OfflineStyleOptions {
  /** Tile-server source id, e.g. `offline-nyc-metro`. */
  sourceId: string;
  /** Loopback base URL, e.g. `http://127.0.0.1:51234` (no trailing slash). */
  tileBaseUrl: string;
  /** Background colour when the base style has no background layer. */
  fallbackBackground: string;
  /**
   * Loopback glyphs template to point the style at, e.g.
   * `http://127.0.0.1:51234/offline-fonts/{fontstack}/{range}.pbf`. When
   * omitted the base style's remote glyphs URL is left in place (labels then
   * need a connection).
   */
  glyphsUrl?: string;
}

interface StyleSource {
  type?: string;
  url?: string;
  tiles?: string[];
  maxzoom?: number;
  minzoom?: number;
  attribution?: string;
  [key: string]: unknown;
}

interface StyleLayer {
  id?: string;
  type?: string;
  source?: string;
  [key: string]: unknown;
}

/**
 * Rewrite vector tile sources in `baseStyleJson` to the loopback server.
 *
 * - Every `vector` source becomes `{ type: 'vector', tiles: [<local>],
 *   maxzoom: 12 }` so high zooms overzoom from z12 instead of 404ing.
 * - Online `raster` sources (e.g. satellite imagery) are dropped with their
 *   layers — they can never load offline and would leave black gaps.
 * - `glyphs` are repointed at `options.glyphsUrl` (bundled font ranges served
 *   over the same loopback server) when provided, so labels render fully
 *   offline; otherwise the base style's remote glyphs are kept.
 *
 * Returns `null` when the style has no vector source to rewrite (nothing
 * offline-capable) or the JSON is invalid.
 */
export function buildOfflineStyle(
  baseStyleJson: string,
  options: OfflineStyleOptions,
): string | null {
  let style: { sources?: Record<string, StyleSource>; layers?: StyleLayer[]; glyphs?: unknown };
  try {
    style = JSON.parse(baseStyleJson) as typeof style;
  } catch {
    return null;
  }
  if (!style || typeof style !== 'object' || !style.sources) return null;

  let rewrote = false;
  for (const [key, src] of Object.entries(style.sources)) {
    if (!src || typeof src !== 'object') continue;
    if (src.type === 'vector') {
      style.sources[key] = {
        type: 'vector',
        tiles: [`${options.tileBaseUrl}/${options.sourceId}/{z}/{x}/{y}.pbf`],
        minzoom: 0,
        maxzoom: OFFLINE_PACK_MAXZOOM,
        attribution: src.attribution ?? '© OpenStreetMap contributors',
      };
      rewrote = true;
    } else if (
      src.type === 'raster' &&
      Array.isArray(src.tiles) &&
      src.tiles.some((t) => typeof t === 'string' && t.startsWith('http'))
    ) {
      delete style.sources[key];
    }
  }
  if (!rewrote) return null;

  // Point labels at locally-served font ranges when they were bundled.
  if (options.glyphsUrl) {
    style.glyphs = options.glyphsUrl;
  }

  // Drop layers whose source was removed (online raster), keep the rest.
  style.layers = (style.layers ?? []).filter((l) => !l.source || style.sources?.[l.source]);
  // Guarantee a background so the canvas isn't transparent where imagery was.
  if (!style.layers.some((l) => l.type === 'background')) {
    style.layers.unshift({
      id: 'offline-background',
      type: 'background',
      paint: { 'background-color': options.fallbackBackground },
    });
  }

  return JSON.stringify(style);
}
