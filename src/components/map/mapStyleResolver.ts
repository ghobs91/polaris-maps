import { OPENFREEMAP_STYLE_URL } from '../../constants/config';
import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { SATELLITE_STYLE_JSON } from '../../constants/satelliteStyle';

type MapStylePreference = 'default' | 'satellite' | 'terrain';

interface ResolveMapStyleArgs {
  mapStylePref: MapStylePreference;
  isDark: boolean;
  styleLoadFailed: boolean;
}

const IOS26_COMPAT_LIGHT_STYLE_JSON = JSON.stringify({
  version: 8,
  name: 'Polaris iOS26 Compat Light',
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
      paint: {
        'raster-opacity': 1,
      },
    },
  ],
});

const IOS26_COMPAT_DARK_STYLE_JSON = JSON.stringify({
  version: 8,
  name: 'Polaris iOS26 Compat Dark',
  sources: {
    cartoDarkMatter: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: 'carto-dark-raster',
      type: 'raster',
      source: 'cartoDarkMatter',
      paint: {
        'raster-opacity': 1,
      },
    },
  ],
});

export function resolveMapStyle({
  mapStylePref,
  isDark,
  styleLoadFailed,
}: ResolveMapStyleArgs): string {
  if (styleLoadFailed) {
    return isDark ? IOS26_COMPAT_DARK_STYLE_JSON : IOS26_COMPAT_LIGHT_STYLE_JSON;
  }

  return mapStylePref === 'satellite'
    ? SATELLITE_STYLE_JSON
    : isDark
      ? DARK_MAP_STYLE_JSON
      : OPENFREEMAP_STYLE_URL;
}
