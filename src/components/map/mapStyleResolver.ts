import { DARK_MAP_STYLE_JSON } from '../../constants/darkMapStyle';
import { LIGHT_MAP_STYLE_JSON } from '../../constants/lightMapStyle';
import { SATELLITE_STYLE_JSON } from '../../constants/satelliteStyle';
import { TERRAIN_DARK_STYLE_JSON, TERRAIN_STYLE_JSON } from '../../constants/terrainStyle';

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

  if (mapStylePref === 'satellite') return SATELLITE_STYLE_JSON;
  // Terrain is a free/open topographic raster; when it cannot load, the
  // styleLoadFailed fallback above (and the offline style path) degrade to the
  // base vector style rather than an empty map.
  if (mapStylePref === 'terrain') return isDark ? TERRAIN_DARK_STYLE_JSON : TERRAIN_STYLE_JSON;
  return isDark ? DARK_MAP_STYLE_JSON : LIGHT_MAP_STYLE_JSON;
}

/** Set the visibility of a layer in a serialised style JSON. */
export function setLayerVisibilityInStyle(
  styleJson: string,
  layerId: string,
  visibility: 'visible' | 'none',
): string {
  const style = JSON.parse(styleJson);
  const layer = style.layers?.find((l: { id: string }) => l.id === layerId);
  if (layer) {
    layer.layout = { ...layer.layout, visibility };
  }
  return JSON.stringify(style);
}
