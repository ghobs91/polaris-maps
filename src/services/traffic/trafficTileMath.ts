import type { TileKey } from '../../models/trafficTile';

/**
 * Pure Web Mercator tile math for traffic tile coverage (no native imports).
 */

/** Round a zoom level into the range the traffic tile source supports. */
export function clampTrafficZoom(zoom: number): number {
  return Math.max(4, Math.min(14, Math.round(zoom)));
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
  const centerY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

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
