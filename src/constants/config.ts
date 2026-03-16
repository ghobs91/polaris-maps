/**
 * App-wide configuration constants.
 *
 * All map tiles are sourced from OpenFreeMap (vector tiles backed by
 * OpenStreetMap data). No API keys or registration required.
 *
 * For offline use, tiles are first shared via Hyperdrive P2P. If not
 * available from peers, they are fetched on-demand from OpenFreeMap.
 */

/** OpenFreeMap MapLibre style URL — global vector tiles, no download needed. */
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** CARTO Dark Matter MapLibre style — used when the app is in dark mode. No API key required. */
export const MAP_STYLE_URL_DARK =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** OpenFreeMap TileJSON endpoint for the planet vector tile source. */
export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

/** TomTom Traffic Flow API base URL. */
export const TOMTOM_FLOW_BASE_URL =
  'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute';

/** HERE Traffic Flow v7 API base URL. */
export const HERE_FLOW_BASE_URL = 'https://data.traffic.hereapi.com/v7/flow';

/** TomTom Traffic Flow raster tile base URL. */
export const TOMTOM_FLOW_TILES_BASE_URL = 'https://api.tomtom.com/traffic/map/4/tile/flow/absolute';

/** TomTom API key — set EXPO_PUBLIC_TOMTOM_API_KEY in .env */
export const tomtomApiKey: string = process.env.EXPO_PUBLIC_TOMTOM_API_KEY ?? '';

/** HERE API key — set EXPO_PUBLIC_HERE_API_KEY in .env */
export const hereApiKey: string = process.env.EXPO_PUBLIC_HERE_API_KEY ?? '';

/** Debounce delay (ms) for viewport-triggered traffic fetches. */
export const TRAFFIC_FETCH_DEBOUNCE_MS = 800;

/** Periodic traffic refresh interval (ms) during active navigation. */
export const TRAFFIC_REFRESH_INTERVAL_MS = 60_000;
