/**
 * Unified imagery source registry for the tile router.
 *
 * Combines the verified global satellite/aerial providers with the regional
 * orthophoto registry (`src/constants/orthophotoSources.ts`). This is the list
 * the routing engine ranks; the MapLibre style consumes the regional subset.
 *
 * Every tile template here was live-verified to return image bytes. OpenAerialMap
 * is served through its v2 Global TMS (`https://global.imagery.hotosm.org/
 * {z}/{x}/{y}.png`): z0–13 renders a density grid of where imagery exists and
 * z14+ redirects to TiTiler for the real imagery (204 where there is none, so
 * gaps fall through). It is patchy — imagery only where contributors uploaded
 * it — so it is in the router registry (selectable where it covers the viewport)
 * but is NOT emitted as a global layer by `satelliteStyle.ts`, which would
 * request it worldwide.
 */

import {
  REGIONAL_ORTHOPHOTO_SOURCES,
  type RegionalOrthophotoSource,
} from '../../constants/orthophotoSources';
import {
  rankImagerySources,
  selectBestTileSource,
  type BBox,
  type ImagerySource,
  type RankOptions,
  type SelectedTileSource,
} from './tileRouter';

/** OpenAerialMap STAC search endpoint (verified returning a FeatureCollection). */
export const OAM_STAC_SEARCH_URL = 'https://api.imagery.hotosm.org/stac/search';

export const GLOBAL_IMAGERY_SOURCES: ImagerySource[] = [
  {
    id: 'eox-s2cloudless',
    label: 'Sentinel-2 cloudless 2020 (EOx)',
    kind: 'satellite',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 14,
    resolutionM: 10,
    acquiredAt: '2020-01-01',
    attribution: 'Sentinel-2 cloudless by EOX',
    bounds: null,
  },
  {
    id: 'usgs-naip',
    label: 'USGS NAIP / The National Map (CONUS)',
    kind: 'ortho',
    tiles: [
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 16,
    resolutionM: 2.4,
    acquiredAt: '2023-06-01',
    attribution: 'Imagery: USGS The National Map (NAIP)',
    bounds: [-125.0, 24.39, -66.94, 49.38],
  },
  {
    id: 'gibs-landsat',
    label: 'Landsat (NASA GIBS, annual true colour)',
    kind: 'satellite',
    tiles: [
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
        '/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default' +
        '/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
    resolutionM: 30,
    acquiredAt: '2023-06-01',
    attribution: 'NASA EOSDIS GIBS / USGS Landsat',
    bounds: null,
  },
  {
    id: 'gibs-modis',
    label: 'MODIS Terra true colour (NASA GIBS, daily)',
    kind: 'satellite',
    tiles: [
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
        '/MODIS_Terra_CorrectedReflectance_TrueColor/default' +
        '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 9,
    resolutionM: 250,
    acquiredAt: '2026-09-29',
    attribution: 'NASA EOSDIS GIBS / MODIS',
    bounds: null,
  },
  {
    id: 'gibs-viirs',
    label: 'VIIRS SNPP true colour (NASA GIBS, daily)',
    kind: 'satellite',
    tiles: [
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
        '/VIIRS_SNPP_CorrectedReflectance_TrueColor/default' +
        '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    ],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 9,
    resolutionM: 375,
    acquiredAt: '2026-09-29',
    attribution: 'NASA EOSDIS GIBS / VIIRS',
    bounds: null,
  },
  {
    id: 'oam',
    label: 'OpenAerialMap (global TMS; patchy coverage)',
    kind: 'ortho',
    // OAM v2 Global TMS: one XYZ endpoint. z0–13 is a density grid, z14+ is the
    // real imagery via a TiTiler redirect (204 where there is none, so gaps fall
    // through). Kept out of the static global style (the density grid would
    // paint as if it were imagery); the runtime mounts it only where coverage
    // exists.
    tiles: ['https://global.imagery.hotosm.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    minzoom: 14,
    maxzoom: 21,
    resolutionM: 0.15,
    acquiredAt: '2025-06-01',
    attribution: '© OpenAerialMap contributors (CC-BY 4.0)',
    bounds: null,
  },
];

function toImagerySource(source: RegionalOrthophotoSource): ImagerySource {
  return {
    id: source.id,
    label: source.label,
    kind: 'ortho',
    tiles: source.tiles,
    tileSize: source.tileSize,
    scheme: source.scheme,
    minzoom: source.minzoom ?? 0,
    maxzoom: source.maxzoom,
    resolutionM: source.resolutionM,
    acquiredAt: source.acquiredAt,
    attribution: source.attribution,
    bounds: source.bounds,
    auth: source.auth,
  };
}

export const REGIONAL_IMAGERY_SOURCES: ImagerySource[] =
  REGIONAL_ORTHOPHOTO_SOURCES.map(toImagerySource);

/** Every source the router knows about, global and regional. */
export const IMAGERY_SOURCES: ImagerySource[] = [
  ...GLOBAL_IMAGERY_SOURCES,
  ...REGIONAL_IMAGERY_SOURCES,
];

/**
 * Best source for a viewport, plus the ordered fallback queue. Defaults to the
 * full registry.
 */
export function selectBestImagerySource(
  bbox: BBox,
  zoomLevel: number,
  sources: ImagerySource[] = IMAGERY_SOURCES,
  options: RankOptions = {},
): SelectedTileSource {
  return selectBestTileSource(bbox, zoomLevel, sources, options);
}

/** Ranked fallback queue for a viewport. */
export function rankImageryForViewport(
  bbox: BBox,
  zoomLevel: number,
  sources: ImagerySource[] = IMAGERY_SOURCES,
  options: RankOptions = {},
): ImagerySource[] {
  return rankImagerySources(bbox, zoomLevel, sources, options);
}

export { rankImagerySources, selectBestTileSource };
export type { ImagerySource, RankOptions, SelectedTileSource, BBox };
