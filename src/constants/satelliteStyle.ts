/**
 * MapLibre style for satellite/aerial imagery layer.
 *
 * Uses free/open imagery only, layered from coarse to fine:
 *   - EOx Sentinel-2 cloudless for global coverage (~10 m), always present.
 *   - USGS The National Map orthoimagery over the US (public domain): the
 *     cached basemap (~2.4 m at its ~z16 limit) plus a 0.6 m on-demand
 *     ImageServer overlay for z17+.
 *   - Regional European orthophotos (5–60 cm) from `orthophotoSources.ts`,
 *     each bounded to its coverage so tiles are only requested where the
 *     provider has imagery. Tiled (XYZ/WMTS) and WMS/Map sources are both
 *     supported; free-key providers are emitted only when their
 *     `EXPO_PUBLIC_*` credentials are set.
 *
 * Each source declares its data's native `maxzoom` so MapLibre does not
 * over-zoom low-resolution tiles; deeper zooms scale the last available tile.
 *
 * The style overlays OpenFreeMap vector labels on top of raster imagery
 * so road names, places, and boundaries remain readable.
 */

import { withGlobalFallback } from '../services/map/tileFallback';
import { REGIONAL_ORTHOPHOTO_SOURCES, type RegionalOrthophotoSource } from './orthophotoSources';
import { LABEL_LAYERS, MAP_GLYPHS_URL, OPENMAPTILES_SOURCE } from './mapLabels';

// Global base templates, best first. MapLibre only requests the next URL when
// one errors, so Landsat is a free outage fallback behind the EOx mosaic.
const GLOBAL_BASE_TILES = [
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
    '/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default' +
    '/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg',
];

// Append a provider's free-key query params (read from EXPO_PUBLIC_* env vars)
// to its tile templates. Returns null when any required env var is unset, so
// the provider is omitted rather than rendering broken tiles.
function applyAuth(tiles: string[], auth: RegionalOrthophotoSource['auth']): string[] | null {
  if (!auth || auth.length === 0) return tiles;
  const params: string[] = [];
  for (const { name, envVar } of auth) {
    const value = process.env[envVar];
    if (!value) return null;
    params.push(`${name}=${encodeURIComponent(value)}`);
  }
  const suffix = params.join('&');
  return tiles.map((tile) => `${tile}${tile.includes('?') ? '&' : '?'}${suffix}`);
}

// Some WMS/Map/ArcGIS providers render a blank (white or black) 200 image for
// no-data / out-of-scale requests instead of a 404. Because the tile is opaque,
// it masks everything beneath it — the white and black rectangles seen over
// Europe at continent zoom. Ask those providers for a transparent PNG instead,
// so blank areas fall through to the global base. Templates without a known
// image-format parameter are left untouched.
function requestTransparent(tile: string): string {
  if (tile.includes('format=image/jpeg')) {
    return `${tile.replace('format=image/jpeg', 'format=image/png')}&TRANSPARENT=TRUE`;
  }
  if (tile.includes('FORMAT=image/jpeg')) {
    return `${tile.replace('FORMAT=image/jpeg', 'FORMAT=image/png')}&TRANSPARENT=TRUE`;
  }
  if (tile.includes('format=jpg')) {
    return `${tile.replace('format=jpg', 'format=png32')}&transparent=true`;
  }
  return tile;
}

// One bounded raster source and layer per registered provider. Bounds keep
// out-of-country tiles from ever being requested; `maxzoom` is each
// provider's native pyramid maximum and `minzoom` the level below which it
// paints blank rather than imagery. Each provider falls back to the global
// base so a missing/failed provider tile degrades to global imagery rather
// than a gap (MapLibre only tries the fallback when the first URL errors).
const REGIONAL_SOURCES: Record<string, Record<string, unknown>> = {};
const REGIONAL_LAYERS: Record<string, unknown>[] = [];
for (const provider of REGIONAL_ORTHOPHOTO_SOURCES) {
  const shaped = provider.transparentBlank
    ? provider.tiles.map(requestTransparent)
    : provider.tiles;
  const authed = applyAuth(shaped, provider.auth);
  if (!authed) continue;
  const tiles = withGlobalFallback(authed, [GLOBAL_BASE_TILES[0]]);
  REGIONAL_SOURCES[provider.id] = {
    type: 'raster',
    tiles,
    tileSize: provider.tileSize,
    scheme: provider.scheme ?? 'xyz',
    ...(provider.minzoom !== undefined ? { minzoom: provider.minzoom } : {}),
    maxzoom: provider.maxzoom,
    attribution: provider.attribution,
    bounds: provider.bounds,
  };
  REGIONAL_LAYERS.push({
    id: `${provider.id}-tiles`,
    type: 'raster',
    source: provider.id,
    paint: {
      'raster-opacity': 1,
      'raster-brightness-min': 0.05,
    },
  });
}

const style = {
  version: 8 as const,
  name: 'Polaris Satellite',
  sources: {
    // Global low-resolution base (10 m Sentinel-2). Always present so non-US
    // areas still get imagery. `maxzoom` is the data's native resolution
    // (~9.5 m/px at z14); EOx serves tiles to z18, but requesting beyond the
    // native zoom only wastes bandwidth, so MapLibre over-zooms from z14.
    'satellite-global': {
      type: 'raster' as const,
      tiles: GLOBAL_BASE_TILES,
      tileSize: 256,
      attribution: 'Sentinel-2 cloudless by EOX / NASA GIBS Landsat',
      maxzoom: 14,
    },
    // US orthoimagery drawn on top of the global base. `maxzoom` is the USGS
    // cache's real deepest level (~2.4 m/px): declaring a higher value made
    // MapLibre request z17+ tiles that 404, blanking the overlay above z16 and
    // exposing the blurry 10 m global base. Capping at 16 lets MapLibre
    // over-zoom the deepest real tile instead. Bounded to CONUS: the service
    // returns a coarse global backdrop outside the US, and — because MapLibre
    // renders a whole tile for any tile that intersects a source's bounds —
    // requesting it worldwide painted that backdrop over the global base.
    'satellite-naip': {
      type: 'raster' as const,
      tiles: [
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Imagery: USGS The National Map (NAIP)',
      maxzoom: 16,
      bounds: [-125.0, 24.39, -66.94, 49.38] as [number, number, number, number],
    },
    // 0.6 m US imagery from the USGS NAIP ImageServer, which renders any bbox
    // on demand rather than serving a fixed pyramid — so it stays sharp where
    // the cached service stops at z16. It takes over from z17 (at z16 the tile
    // covers the same ground as the cache, so there is no extra detail to
    // gain). Bounded to CONUS: outside its coverage the service returns an
    // opaque black image, which would mask the base rather than fall through.
    'satellite-naip-hires': {
      type: 'raster' as const,
      tiles: [
        'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage' +
          '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image',
      ],
      tileSize: 256,
      attribution: 'Imagery: USGS The National Map (NAIP)',
      minzoom: 17,
      maxzoom: 19,
      bounds: [-125.0, 24.39, -66.94, 49.38] as [number, number, number, number],
    },
    openmaptiles: OPENMAPTILES_SOURCE,
    ...REGIONAL_SOURCES,
  },
  glyphs: MAP_GLYPHS_URL,
  layers: [
    // ───────────────────── Satellite Imagery ─────────────────────
    {
      id: 'satellite-global-tiles',
      type: 'raster',
      source: 'satellite-global',
      paint: {
        'raster-opacity': 1,
        'raster-brightness-min': 0.05,
      },
    },
    {
      id: 'satellite-naip-tiles',
      type: 'raster',
      source: 'satellite-naip',
      paint: {
        'raster-opacity': 1,
        'raster-brightness-min': 0.05,
      },
    },
    {
      id: 'satellite-naip-hires-tiles',
      type: 'raster',
      source: 'satellite-naip-hires',
      paint: {
        'raster-opacity': 1,
        'raster-brightness-min': 0.05,
      },
    },

    // Regional European orthophotos, finest available per country, above the
    // global base and NAIP but below the labels.
    ...REGIONAL_LAYERS,

    ...LABEL_LAYERS,
  ],
};

/** Serialized MapLibre style JSON for satellite view. */
export const SATELLITE_STYLE_JSON = JSON.stringify(style);
