/**
 * MapLibre style for satellite/aerial imagery layer.
 *
 * Uses free/open imagery only, layered from coarse to fine:
 *   - EOx Sentinel-2 cloudless for global coverage (~10 m), always present.
 *   - USGS The National Map orthoimagery (NAIP, ~1 m) over the US (public domain).
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

// One bounded raster source and layer per registered provider. Bounds keep
// out-of-country tiles from ever being requested; `maxzoom` is each
// provider's native pyramid maximum. Each provider falls back to the global
// base so a missing/failed provider tile degrades to global imagery rather
// than a gap (MapLibre only tries the fallback when the first URL errors).
const REGIONAL_SOURCES: Record<string, Record<string, unknown>> = {};
const REGIONAL_LAYERS: Record<string, unknown>[] = [];
for (const provider of REGIONAL_ORTHOPHOTO_SOURCES) {
  const authed = applyAuth(provider.tiles, provider.auth);
  if (!authed) continue;
  const tiles = withGlobalFallback(authed, [GLOBAL_BASE_TILES[0]]);
  REGIONAL_SOURCES[provider.id] = {
    type: 'raster',
    tiles,
    tileSize: provider.tileSize,
    scheme: provider.scheme ?? 'xyz',
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
    // High-resolution US orthoimagery (1 m NAIP) drawn on top of the global
    // base. Tiles outside NAIP coverage 404 and fall through to the base.
    // Keeping these in separate sources (rather than one multi-URL source)
    // prevents MapLibre from serving the blurry global tiles in the US.
    'satellite-naip': {
      type: 'raster' as const,
      tiles: [
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Imagery: USGS The National Map (NAIP)',
      maxzoom: 19,
    },
    openmaptiles: {
      type: 'vector' as const,
      url: 'https://tiles.openfreemap.org/planet',
    },
    ...REGIONAL_SOURCES,
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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

    // Regional European orthophotos, finest available per country, above the
    // global base and NAIP but below the labels.
    ...REGIONAL_LAYERS,

    // ───────────────────── Road Labels ─────────────────────
    {
      id: 'road-label-primary',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
      minzoom: 10,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13, 18, 16],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 2,
      },
    },
    {
      id: 'road-label-secondary',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['==', 'class', 'secondary'],
      minzoom: 12,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 12, 18, 14],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1.8,
      },
    },
    {
      id: 'road-label-minor',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: ['in', 'class', 'minor', 'tertiary', 'service'],
      minzoom: 14,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': '#EEEEEE',
        'text-halo-color': 'rgba(0,0,0,0.65)',
        'text-halo-width': 1.5,
      },
    },

    // ───────────────────── Place Labels ─────────────────────
    {
      id: 'place-country',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'country'],
      minzoom: 2,
      maxzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 14],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 2.5,
      },
    },
    {
      id: 'place-state',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'state'],
      minzoom: 4,
      maxzoom: 10,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 12],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#EEEEEE',
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 2,
      },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'city'],
      minzoom: 4,
      maxzoom: 14,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 18],
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 2.5,
      },
    },
    {
      id: 'place-town',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'town'],
      minzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 14, 16, 17],
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#FFFFFF',
        'text-halo-color': 'rgba(0,0,0,0.75)',
        'text-halo-width': 2,
      },
    },
    {
      id: 'place-village',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['in', 'class', 'village', 'hamlet'],
      minzoom: 10,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12, 18, 15],
        'text-max-width': 7,
      },
      paint: {
        'text-color': '#EEEEEE',
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1.5,
      },
    },

    // ───────────────────── Water Labels ─────────────────────
    {
      id: 'water-name-ocean',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['==', 'class', 'ocean'],
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 12, 8, 16],
        'text-letter-spacing': 0.15,
        'text-max-width': 8,
      },
      paint: {
        'text-color': '#8EBFFF',
        'text-halo-color': 'rgba(0,0,0,0.6)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water-name-other',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      filter: ['!in', 'class', 'ocean'],
      minzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
        'text-max-width': 6,
      },
      paint: {
        'text-color': '#8EBFFF',
        'text-halo-color': 'rgba(0,0,0,0.55)',
        'text-halo-width': 1.2,
      },
    },
  ],
};

/** Serialized MapLibre style JSON for satellite view. */
export const SATELLITE_STYLE_JSON = JSON.stringify(style);
