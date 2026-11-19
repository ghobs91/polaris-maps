import type { TileKey } from '../../models/trafficTile';

/**
 * Pure Web Mercator tile math for traffic tile coverage (no native imports).
 */

/** Web Mercator tile → its centre coordinate (lng, lat). */
export function tileCenter(key: TileKey): { lng: number; lat: number } {
  const n = Math.pow(2, key.z);
  const lng = ((key.x + 0.5) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (key.y + 0.5)) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

/** Lowest zoom the traffic raster source asks for. */
export const MIN_TRAFFIC_TILE_ZOOM = 4;

/**
 * Highest zoom we ever hold a traffic tile for.
 *
 * Seeding stops here, so the raster source must be told the same limit:
 * MapLibre overzooms the z14 tiles beyond this instead of asking the local
 * server for z15+ tiles that were never seeded (which 404 and leave the
 * layer blank when zoomed in).
 */
export const MAX_TRAFFIC_TILE_ZOOM = 14;

/**
 * Seed zoom for a map zoom.
 *
 * `Math.floor`, not `Math.round`: MapLibre requests the tile at
 * `floor(zoom)`, so rounding 13.6 up to 14 seeds a level the map never asks
 * for and leaves the z13 requests unanswered.
 */
export function clampTrafficZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAX_TRAFFIC_TILE_ZOOM;
  return Math.max(MIN_TRAFFIC_TILE_ZOOM, Math.min(MAX_TRAFFIC_TILE_ZOOM, Math.floor(zoom)));
}

/**
 * Compute the z/x/y tiles covering the visible viewport at the given zoom,
 * sorted center-first so seeding prioritizes what the user sees first.
 * Uses standard Web Mercator math (matches tilePixelSampler).
 */
export function tilesForViewport(
  centerLat: number,
  centerLng: number,
  zoom: number,
  screenWidth: number,
  screenHeight: number,
): TileKey[] {
  const z = clampTrafficZoom(zoom);

  const n = Math.pow(2, z);
  const centerX = ((centerLng + 180) / 360) * n;
  const latRad = (centerLat * Math.PI) / 180;
  const centerY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  // Visible span in tile units: screen pixels → 256px tiles.
  const tilesX = Math.ceil(screenWidth / 256) + 1;
  const tilesY = Math.ceil(screenHeight / 256) + 1;

  const minX = Math.max(0, Math.floor(centerX - tilesX / 2));
  const maxX = Math.min(n - 1, Math.ceil(centerX + tilesX / 2));
  const minY = Math.max(0, Math.floor(centerY - tilesY / 2));
  const maxY = Math.min(n - 1, Math.ceil(centerY + tilesY / 2));

  const cx = Math.floor(centerX);
  const cy = Math.floor(centerY);
  const byDistance: Array<{ key: TileKey; d: number }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      byDistance.push({
        key: { z, x, y },
        d: (x - cx) * (x - cx) + (y - cy) * (y - cy),
      });
    }
  }
  byDistance.sort((a, b) => a.d - b.d);
  return byDistance.map((t) => t.key);
}
