/**
 * Terrain / topographic style.
 *
 * Uses OpenTopoMap raster tiles — a free, community-rendered topographic map
 * (contours + hillshade) under CC-BY-SA. A `dark` variant dims and desaturates
 * the raster so it stays legible in dark mode. No paid provider is involved.
 */

function buildTerrainStyle(isDark: boolean) {
  return {
    version: 8 as const,
    name: isDark ? 'Polaris Terrain Dark' : 'Polaris Terrain',
    sources: {
      terrain: {
        type: 'raster' as const,
        tiles: [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors',
        maxzoom: 17,
      },
    },
    layers: [
      {
        id: 'terrain-raster',
        type: 'raster',
        source: 'terrain',
        paint: isDark
          ? {
              'raster-opacity': 1,
              'raster-brightness-max': 0.65,
              'raster-saturation': -0.25,
            }
          : {
              'raster-opacity': 1,
            },
      },
    ],
  };
}

/** Serialized MapLibre style JSON for terrain (light). */
export const TERRAIN_STYLE_JSON = JSON.stringify(buildTerrainStyle(false));

/** Serialized MapLibre style JSON for terrain (dark). */
export const TERRAIN_DARK_STYLE_JSON = JSON.stringify(buildTerrainStyle(true));
