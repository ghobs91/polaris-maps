/**
 * Runtime satellite layer manager.
 *
 * `satelliteStyle.ts` mounts every regional orthophoto provider at once. This
 * module narrows that to the providers that can actually serve the current
 * viewport, using the tile router's spatial + zoom eligibility, so only
 * relevant sources/layers are mounted as the camera moves. It is the runtime
 * consumer of `tileRouter.ts` (previously test-only).
 *
 * Rendering order stays the curated registry order (widest providers first,
 * narrowest last) — see the tile-router design's Decision 4 — because
 * resolution-sorting alone would let a finer wide provider mask a coarser
 * narrow one. The router decides *which* providers mount, not their stacking.
 */

import { LABEL_ATTRIBUTION } from '../../constants/mapLabels';
import {
  REGIONAL_ORTHOPHOTO_SOURCES,
  type RegionalOrthophotoSource,
} from '../../constants/orthophotoSources';
import {
  SATELLITE_GLOBAL_ATTRIBUTION,
  SATELLITE_NAIP_ATTRIBUTION,
  SATELLITE_NAIP_BOUNDS,
  buildSatelliteStyleJson,
} from '../../constants/satelliteStyle';
import { applyLabelLanguage } from './labelLanguage';
import { REGIONAL_IMAGERY_SOURCES } from './imagerySources';
import { OAM_MIN_ZOOM, oamOverlaySource } from './oamCoverage';
import { boundsIntersect, rankImagerySources, type BBox, type RankOptions } from './tileRouter';

/**
 * Upper bound on mounted regional providers. City viewports intersect only a
 * handful; this only bites at low zoom, where it keeps the style light without
 * dropping the providers that cover most of the screen.
 */
export const DEFAULT_MAX_VIEWPORT_SOURCES = 8;

export interface ViewportRegionalOptions {
  rankOptions?: RankOptions;
  /**
   * Maximum regional providers to mount. When more intersect the viewport, the
   * providers covering the most of it are kept (finer resolution breaks ties),
   * then the survivors are returned in curated registry order.
   */
  maxSources?: number;
}

/** Area (in square degrees) shared by `bounds` and the viewport. */
function overlapArea(bounds: BBox, viewport: BBox): number {
  const west = Math.max(bounds[0], viewport[0]);
  const south = Math.max(bounds[1], viewport[1]);
  const east = Math.min(bounds[2], viewport[2]);
  const north = Math.min(bounds[3], viewport[3]);
  if (west >= east || south >= north) return 0;
  return (east - west) * (north - south);
}

/**
 * Regional providers that can serve `bbox` at `zoom`, in curated registry
 * order. Empty when no provider covers the viewport (e.g. open ocean). Capped
 * to `maxSources` (largest viewport overlap first) when many qualify.
 */
export function selectViewportRegionalSources(
  bbox: BBox,
  zoom: number,
  options: ViewportRegionalOptions = {},
): RegionalOrthophotoSource[] {
  const eligible = rankImagerySources(bbox, zoom, REGIONAL_IMAGERY_SOURCES, options.rankOptions);
  const max = options.maxSources ?? DEFAULT_MAX_VIEWPORT_SOURCES;
  const kept =
    eligible.length > max
      ? [...eligible]
          .sort(
            (a, b) =>
              overlapArea(b.bounds ?? bbox, bbox) - overlapArea(a.bounds ?? bbox, bbox) ||
              a.resolutionM - b.resolutionM ||
              a.id.localeCompare(b.id),
          )
          .slice(0, max)
      : eligible;
  const keptIds = new Set(kept.map((source) => source.id));
  return REGIONAL_ORTHOPHOTO_SOURCES.filter((source) => keptIds.has(source.id));
}

/** Ids of the regional providers serving the viewport (cheap change detection). */
export function viewportRegionalSourceIds(
  bbox: BBox,
  zoom: number,
  options: ViewportRegionalOptions = {},
): string[] {
  return selectViewportRegionalSources(bbox, zoom, options).map((source) => source.id);
}

export interface ViewportStyleOptions extends ViewportRegionalOptions {
  /**
   * OpenAerialMap coverage for the viewport (from `findOamCoverage`). When
   * present, the OAM mosaic is layered on top of the regional providers,
   * bounded to that coverage so it is only requested where imagery exists.
   */
  coverage?: BBox | null;
  /** BCP-47 locale for place labels; omit to keep each style's local names. */
  language?: string;
}

/**
 * Build the satellite style for a viewport: the global base, US NAIP overlays,
 * and the union of regional providers (+ optional OpenAerialMap) that serve
 * `bbox` at `zoom`.
 */
export function buildViewportSatelliteStyle(
  bbox: BBox,
  zoom: number,
  options: ViewportStyleOptions = {},
): string {
  const regional = selectViewportRegionalSources(bbox, zoom, options);
  const includeOam = options.coverage != null && zoom >= OAM_MIN_ZOOM;
  const sources = includeOam ? [...regional, oamOverlaySource(options.coverage as BBox)] : regional;
  const json = buildSatelliteStyleJson(sources);
  return options.language ? applyLabelLanguage(json, options.language) : json;
}

/**
 * Attribution strings for the imagery visible at `bbox`/`zoom` — the global
 * base, the US NAIP overlays when in CONUS, the serving regional providers,
 * OpenAerialMap when layered, and the vector label overlay. Deduplicated, in
 * layer order.
 */
export function viewportImageryAttributions(
  bbox: BBox,
  zoom: number,
  options: ViewportStyleOptions = {},
): string[] {
  const attributions = [SATELLITE_GLOBAL_ATTRIBUTION];
  if (boundsIntersect(SATELLITE_NAIP_BOUNDS, bbox)) {
    attributions.push(SATELLITE_NAIP_ATTRIBUTION);
  }
  for (const source of selectViewportRegionalSources(bbox, zoom, options)) {
    attributions.push(source.attribution);
  }
  if (options.coverage != null && zoom >= OAM_MIN_ZOOM) {
    attributions.push(oamOverlaySource(options.coverage).attribution);
  }
  attributions.push(LABEL_ATTRIBUTION);
  return [...new Set(attributions)];
}

/** Attributions shown before the first viewport settle (base imagery + labels). */
export const BASE_SATELLITE_ATTRIBUTIONS: string[] = [
  SATELLITE_GLOBAL_ATTRIBUTION,
  LABEL_ATTRIBUTION,
];
