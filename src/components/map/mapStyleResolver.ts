import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { LIGHT_MAP_STYLE_JSON } from '../../constants/lightMapStyle';
import { SATELLITE_STYLE_JSON } from '../../constants/satelliteStyle';
import { TERRAIN_DARK_STYLE_JSON, TERRAIN_STYLE_JSON } from '../../constants/terrainStyle';
import { applyLabelLanguage } from '../../services/map/labelLanguage';

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

function buildCompatStyle(isDark: boolean): string {
  return JSON.stringify({
    version: 8,
    name: isDark ? 'Polaris iOS26 Compat Dark' : 'Polaris iOS26 Compat Light',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'osm-raster',
        type: 'raster',
        source: 'osm',
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

  // Localise vector place labels (light/dark and the satellite label overlay)
  // into the user's language. The raster styles — terrain and the iOS 26
  // compatibility fallback — carry their labels baked into the imagery, so
  // there is no `text-field` to rewrite and this is a no-op for them.
  return language ? applyLabelLanguage(base, language) : base;
}

// Navigation-focus rewriting (hidden labels, faded ground cover, dark-mode
// water) lives in `src/services/map/navFocusStyle.ts`.
