import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { LIGHT_MAP_STYLE_JSON } from '../../constants/lightMapStyle';
import { SATELLITE_STYLE_JSON } from '../../constants/satelliteStyle';
import { TERRAIN_DARK_STYLE_JSON, TERRAIN_STYLE_JSON } from '../../constants/terrainStyle';
import { applyLabelLanguage } from '../../services/map/labelLanguage';
import { applyBasemapSource } from '../../services/map/basemapSource';

type MapStylePreference = 'default' | 'satellite' | 'terrain';

interface ResolveMapStyleArgs {
  mapStylePref: MapStylePreference;
  isDark: boolean;
  styleLoadFailed: boolean;
  /**
   * BCP-47 locale for place labels (e.g. `en-US`). Omit to keep each style's
   * local names, which is also the identity path the unit tests pin.
   */
  language?: string;
}

/**
 * Global raster used when the vector style itself fails to load.
 *
 * This previously pointed at `tile.openstreetmap.org`, which is the OSM
 * Foundation's own tile server. Its usage policy explicitly excludes
 * applications of this kind, so the app's last-resort fallback was a server
 * that does not permit it — a fallback that works only until somebody notices.
 *
 * NASA GIBS is a government service with a published, permissive access policy
 * and no per-application quota. It is satellite imagery with no labels, so this
 * is a "something is on screen, pan to find your bearings" state rather than a
 * usable street map. That is the correct trade for a path this rare: it exists
 * because a bundled style failed to parse, not because the network is down.
 */
const COMPAT_RASTER_TILES = [
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best' +
    '/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default' +
    '/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpg',
];

function buildCompatStyle(isDark: boolean): string {
  return JSON.stringify({
    version: 8,
    name: isDark ? 'Polaris iOS26 Compat Dark' : 'Polaris iOS26 Compat Light',
    sources: {
      compat: {
        type: 'raster',
        tiles: COMPAT_RASTER_TILES,
        tileSize: 256,
        attribution: 'NASA GIBS / Landsat',
        maxzoom: 12,
      },
    },
    layers: [
      {
        id: 'compat-raster',
        type: 'raster',
        source: 'compat',
        // Dark mode dims and desaturates the raster so it stays legible; the
        // raster compat style has no dark tile source of its own.
        paint: isDark
          ? {
              'raster-opacity': 1,
              'raster-brightness-max': 0.55,
              'raster-saturation': -0.25,
            }
          : {
              'raster-opacity': 1,
            },
      },
    ],
  });
}

const IOS26_COMPAT_LIGHT_STYLE_JSON = buildCompatStyle(false);
const IOS26_COMPAT_DARK_STYLE_JSON = buildCompatStyle(true);

export function resolveMapStyle({
  mapStylePref,
  isDark,
  styleLoadFailed,
  language,
}: ResolveMapStyleArgs): string {
  let base: string;
  if (styleLoadFailed) {
    base = isDark ? IOS26_COMPAT_DARK_STYLE_JSON : IOS26_COMPAT_LIGHT_STYLE_JSON;
  } else if (mapStylePref === 'satellite') {
    base = SATELLITE_STYLE_JSON;
  } else if (mapStylePref === 'terrain') {
    base = isDark ? TERRAIN_DARK_STYLE_JSON : TERRAIN_STYLE_JSON;
  } else {
    base = isDark ? DARK_MAP_STYLE_JSON : LIGHT_MAP_STYLE_JSON;
  }

  // Point the vector basemap at a configured alternative when one is set.
  // No-op (and free) when it is not, which is the normal case.
  base = applyBasemapSource(base);

  // Localise vector place labels (light/dark and the satellite label overlay)
  // into the user's language. The raster styles — terrain and the iOS 26
  // compatibility fallback — carry their labels baked into the imagery, so
  // there is no `text-field` to rewrite and this is a no-op for them.
  return language ? applyLabelLanguage(base, language) : base;
}

// Navigation-focus rewriting (hidden labels, faded ground cover, dark-mode
// water) lives in `src/services/map/navFocusStyle.ts`.
