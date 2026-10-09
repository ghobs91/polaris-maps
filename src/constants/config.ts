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

/** OpenFreeMap TileJSON endpoint for the planet vector tile source. */
export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

/** TomTom Traffic Flow API base URL (bounded cold-start bridge only). */
export const TOMTOM_FLOW_BASE_URL =
  'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute';

/** TomTom Traffic Flow raster tile base URL. */
export const TOMTOM_FLOW_TILES_BASE_URL = 'https://api.tomtom.com/traffic/map/4/tile/flow/absolute';

/**
 * TomTom API key — set EXPO_PUBLIC_TOMTOM_API_KEY in .env.
 *
 * TomTom is an optional, lowest-priority cold-start bridge so traffic works
 * before the P2P network and free open feeds are dense enough. It is never
 * required; when absent, higher tiers (P2P, open feeds) serve traffic.
 */
export const tomtomApiKey: string = process.env.EXPO_PUBLIC_TOMTOM_API_KEY ?? '';

/** Debounce delay (ms) for viewport-triggered traffic fetches. */
export const TRAFFIC_FETCH_DEBOUNCE_MS = 800;

/** Periodic traffic refresh interval (ms) during active navigation. */
export const TRAFFIC_REFRESH_INTERVAL_MS = 60_000;

/**
 * Overture Maps data release pinned as the fallback / offline default. The
 * app discovers the live release from {@link OVERTURE_STAC_CATALOG_URL} at
 * runtime (releases are rotated and only retained ~60 days), so this only
 * needs to be fresh enough to be a valid fallback.
 */
export const OVERTURE_RELEASE = '2026-09-23.1';

/**
 * Overture's STAC catalog. Its `latest` field names the current release; Overture
 * recommends resolving the release here rather than hard-coding a date, because
 * public releases are retired after ~60 days.
 * See https://docs.overturemaps.org/getting-data/cloud-sources/
 */
export const OVERTURE_STAC_CATALOG_URL = 'https://stac.overturemaps.org/catalog.json';

/**
 * Overture-hosted PMTiles archive URL for a given release and theme.
 *
 * Warning: Overture publishes these tiles for data inspection only and does not
 * guarantee their layers, properties, or zoom levels across releases. The
 * `overtureFetcher` clamps tile requests to the archive header's `maxZoom` and
 * resolves the current release from STAC so a rotating release path can't
 * silently empty the map.
 * See https://docs.overturemaps.org/examples/overture-tiles/
 */
export function overturePmtilesUrl(release: string, theme = 'places'): string {
  return `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${release}/${theme}.pmtiles`;
}

/**
 * Fallback PMTiles archive for places (the pinned {@link OVERTURE_RELEASE}
 * unless explicitly overridden). `overtureFetcher` prefers the STAC-resolved
 * release and treats this as the offline / failure fallback.
 */
export const OVERTURE_PLACES_PM_TILES_URL: string =
  process.env.EXPO_PUBLIC_OVERTURE_PLACES_PM_TILES_URL ?? overturePmtilesUrl(OVERTURE_RELEASE);

/** Overture GeoParquet S3 path for places. */
export const OVERTURE_PLACES_S3 = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*`;

// ── Transit ─────────────────────────────────────────────────────────

/** MobilityData Mobility Database API base URL. */
export const MOBILITY_DB_API_URL = 'https://api.mobilitydatabase.org';

/** MobilityData API key — set EXPO_PUBLIC_MOBILITY_DB_API_KEY in .env */
export const mobilityDbRefreshToken: string =
  process.env.EXPO_PUBLIC_MOBILITY_DB_API_KEY ??
  process.env.MOBILITY_DATABASE_SERVICE_API_KEY ??
  '';

/** OpenTripPlanner GTFS GraphQL API base URL — set EXPO_PUBLIC_OTP_BASE_URL in .env */
export const OTP_BASE_URL: string = process.env.EXPO_PUBLIC_OTP_BASE_URL ?? '';

/** Transitous MOTIS 2 API base URL — set EXPO_PUBLIC_TRANSITOUS_BASE_URL in .env */
export const TRANSITOUS_BASE_URL: string =
  process.env.EXPO_PUBLIC_TRANSITOUS_BASE_URL ?? 'https://api.transitous.org/api';

// ── Street-level imagery ────────────────────────────────────────────

/**
 * Mapillary client token — set EXPO_PUBLIC_MAPILLARY_TOKEN in .env.
 * Street-level imagery is an explicit exception to the no-corporate-cloud
 * rule: it is opt-in (feature hidden without a token), online-only, and
 * never used as a primary or cached source. Panoramax (open, no token) fills
 * the gaps where Mapillary has no coverage.
 */
export const MAPILLARY_TOKEN: string = process.env.EXPO_PUBLIC_MAPILLARY_TOKEN ?? '';

/** Panoramax STAC search endpoint (open street-level imagery, CC-BY-SA). */
export const PANORAMAX_SEARCH_URL = 'https://api.panoramax.xyz/api/search';

/**
 * Panoramax coverage vector tiles (STAC "geovisio" source). Layers:
 * `sequences` (LineString) and `pictures` (Point). No token required.
 */
export const PANORAMAX_TILES_URL = 'https://api.panoramax.xyz/api/map/{z}/{x}/{y}.mvt';

/**
 * Mapillary coverage vector tiles — only fetched when a token is configured.
 * `mly1_public` layers: `overview` (Point, z0–5), `sequence` (LineString, z6–14)
 * and `image` (Point, z14). Token is appended as `access_token`.
 */
export const MAPILLARY_TILES_URL_TEMPLATE =
  'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}';

/** Build the Mapillary coverage tile URL with the configured token. */
export function mapillaryCoverageTileUrl(token: string): string {
  return `${MAPILLARY_TILES_URL_TEMPLATE}?access_token=${encodeURIComponent(token)}`;
}

/** OTP GraphQL endpoint path. */
export const OTP_GRAPHQL_PATH = '/otp/gtfs/v1';

/** Debounce delay (ms) for transit stop fetch when viewport changes. */
export const TRANSIT_FETCH_DEBOUNCE_MS = 500;

/** Cache TTL (ms) for transit feed discovery results. */
export const TRANSIT_FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Offline Region Data CDN ─────────────────────────────────────────

/** URL for the master region catalog manifest (JSON). */
export const REGION_CATALOG_URL =
  process.env.EXPO_PUBLIC_REGION_CATALOG_URL ?? 'https://cdn.example.com/regions/catalog.json';

/** URL for the global GeoNames SQLite database (gzipped). */
export const GEONAMES_DB_URL =
  process.env.EXPO_PUBLIC_GEONAMES_DB_URL ?? 'https://cdn.example.com/global/geonames.sqlite.gz';

/**
 * GitHub repository publishing pre-built offline routing graphs via Releases.
 *
 * `build-region-data.yml` uploads `<regionId>-routing.tar` assets to a
 * `map-data-*` release here; the app downloads and extracts them during region
 * download so on-device Valhalla works offline. Set to an empty string to
 * disable GitHub Releases routing downloads (P2P packs still work).
 */
export const REGION_DATA_REPO: string =
  process.env.EXPO_PUBLIC_REGION_DATA_REPO ?? 'ghobs91/polaris-maps';
