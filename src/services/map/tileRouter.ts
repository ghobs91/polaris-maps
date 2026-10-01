/**
 * Satellite/aerial tile routing engine.
 *
 * Given a viewport bounding box and zoom level, ranks every imagery source
 * that can serve it by:
 *   1. spatial intersection (source coverage vs. viewport), and
 *   2. zoom support (no excessive up-scaling), then
 *   3. resolution in metres/pixel (finer wins), with
 *   4. acquisition recency as a tie-breaker for near-equal resolutions, and
 *   5. a stable id tie-break so ordering is deterministic.
 *
 * The ordered result doubles as a fallback queue: if the top source misses a
 * tile (404) or is slow, the next source can be tried.
 *
 * NOTE ON MAPLIBRE NATIVE: this app uses MapLibre Native via
 * `@maplibre/maplibre-react-native`, which does NOT support a custom URL
 * protocol (no `addProtocol`). Per-tile timeout switching therefore stays in
 * the native-safe multi-URL `tiles` fallback. The engine's runtime consumer is
 * `satelliteRuntimeStyle.ts` + `useSatelliteViewportStyle`, which narrow the
 * mounted regional providers to those serving the current viewport and add
 * OpenAerialMap coverage. See `imagerySources.ts` and the module README.
 */

/** Bounding box `[west, south, east, north]` in degrees. */
export type BBox = [number, number, number, number];

export type ImageryKind = 'ortho' | 'satellite' | 'stac';

export interface ImagerySource {
  id: string;
  label: string;
  kind: ImageryKind;
  /** Raster tile URL template(s); empty for metadata-only STAC sources. */
  tiles: string[];
  tileSize: number;
  scheme?: 'xyz' | 'tms';
  /** Lowest useful zoom; defaults to 0. */
  minzoom: number;
  /** Highest native zoom (beyond this, MapLibre over-zooms). */
  maxzoom: number;
  /** Nominal ground sample distance in metres/pixel. */
  resolutionM: number;
  /** Approximate acquisition/version date as ISO `YYYY-MM-DD`. */
  acquiredAt: string;
  attribution: string;
  /** Coverage extent, or `null` for a global source. */
  bounds: BBox | null;
  /** Free-key query params, sourced from env; skipped when unset. */
  auth?: Array<{ name: string; envVar: string }>;
}

export interface RankOptions {
  /** Extra zoom levels a source may serve by over-zooming. Default 2. */
  maxOverzoom?: number;
  /** Relative resolution window treated as "equal" for recency. Default 0.1. */
  resolutionTolerance?: number;
}

export const DEFAULT_MAX_OVERZOOM = 2;
export const DEFAULT_RESOLUTION_TOLERANCE = 0.1;

/** True when two bounds overlap or touch. */
export function boundsIntersect(a: BBox, b: BBox): boolean {
  const [aw, as, ae, an] = a;
  const [bw, bs, be, bn] = b;
  return aw <= be && ae >= bw && as <= bn && an >= bs;
}

/** True when the source is inside (or intersects) the viewport. Global = always. */
export function sourceCoversBounds(source: ImagerySource, viewport: BBox): boolean {
  if (source.bounds === null) return true;
  return boundsIntersect(source.bounds, viewport);
}

/** True when the source can serve `zoom` without excessive up-scaling. */
export function sourceSupportsZoom(
  source: ImagerySource,
  zoom: number,
  maxOverzoom: number = DEFAULT_MAX_OVERZOOM,
): boolean {
  return zoom >= source.minzoom && zoom <= source.maxzoom + maxOverzoom;
}

function withinResolution(
  a: number,
  b: number,
  tolerance: number = DEFAULT_RESOLUTION_TOLERANCE,
): boolean {
  const lo = Math.min(a, b);
  if (lo <= 0) return true;
  return Math.abs(a - b) <= tolerance * lo;
}

function recency(source: ImagerySource): number {
  const parsed = Date.parse(source.acquiredAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Rank sources for a viewport, best first. Deterministic: resolution first,
 * then recency within the tolerance window, then `id`.
 *
 * Near-equal resolutions are grouped before the recency sort so the result is
 * a strict ordering (a comparator with a tolerance window would not be
 * transitive).
 */
export function rankImagerySources(
  viewport: BBox,
  zoom: number,
  sources: ImagerySource[],
  options: RankOptions = {},
): ImagerySource[] {
  const maxOverzoom = options.maxOverzoom ?? DEFAULT_MAX_OVERZOOM;
  const tolerance = options.resolutionTolerance ?? DEFAULT_RESOLUTION_TOLERANCE;

  const eligible = sources.filter(
    (s) => sourceCoversBounds(s, viewport) && sourceSupportsZoom(s, zoom, maxOverzoom),
  );

  const byResolution = [...eligible].sort(
    (a, b) => a.resolutionM - b.resolutionM || a.id.localeCompare(b.id),
  );

  const groups: ImagerySource[][] = [];
  for (const source of byResolution) {
    const current = groups[groups.length - 1];
    if (current && withinResolution(current[0].resolutionM, source.resolutionM, tolerance)) {
      current.push(source);
    } else {
      groups.push([source]);
    }
  }

  for (const group of groups) {
    group.sort((a, b) => recency(b) - recency(a) || a.id.localeCompare(b.id));
  }

  return groups.flat();
}

export interface SelectedTileSource {
  /** Best source, or null when nothing can serve the viewport. */
  selected: ImagerySource | null;
  /** Full fallback queue, best first. */
  ranked: ImagerySource[];
}

/**
 * Select the best tile source for a viewport and zoom, returning the winner
 * plus the ordered fallback queue.
 */
export function selectBestTileSource(
  viewport: BBox,
  zoom: number,
  sources: ImagerySource[],
  options: RankOptions = {},
): SelectedTileSource {
  const ranked = rankImagerySources(viewport, zoom, sources, options);
  return { selected: ranked[0] ?? null, ranked };
}

// ── Metadata (STAC) caching ─────────────────────────────────────────

export interface TileMetadataCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  clear(): void;
  size(): number;
}

export interface CacheOptions {
  /** Entry lifetime in ms. Default 5 minutes. */
  ttlMs?: number;
  /** Maximum entries before LRU eviction. Default 200. */
  max?: number;
  /** Injectable clock for tests. Default `Date.now`. */
  now?: () => number;
}

/**
 * Small in-memory TTL + LRU cache for STAC/search responses so panning does
 * not re-query metadata on every move.
 */
export function createTileMetadataCache<T>(options: CacheOptions = {}): TileMetadataCache<T> {
  const ttlMs = options.ttlMs ?? 300_000;
  const max = options.max ?? 200;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: T; expiresAt: number }>();

  function evictIfNeeded(): void {
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      // Refresh LRU position.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      evictIfNeeded();
    },
    has(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return false;
      }
      return true;
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
