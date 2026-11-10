/**
 * Offline tile download planning for OpenFreeMap.
 *
 * OpenFreeMap's public instance allows offline area downloads only while each
 * download stays within 3,000 tiles / 50 MB, uses at most 4 parallel requests,
 * and identifies the app with a unique User-Agent
 * (https://openfreemap.org — "Can my app download areas for offline use?").
 *
 * A region's bounds are fixed by the catalog, but its max zoom is not: this
 * planner lowers the zoom (which cuts the tile count by ~4x per level) until
 * the pack fits the tile budget, rather than silently issuing a non-conformant
 * download. If even the minimum zoom does not fit, the caller must refuse.
 */

import type { Region } from '../../models/region';

/** Hard cap from OpenFreeMap's offline-download policy. */
export const OPENFREEMAP_MAX_TILES_PER_DOWNLOAD = 3_000;
/** Hard cap from OpenFreeMap's offline-download policy (50 MB). */
export const OPENFREEMAP_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** Concurrency cap from OpenFreeMap's offline-download policy. */
export const OPENFREEMAP_MAX_PARALLEL_DOWNLOADS = 4;

/** Highest zoom downloaded for an offline pack (city-level detail). */
export const OFFLINE_TILE_MAX_ZOOM = 12;
/** Lowest zoom downloaded for an offline pack (world overview). */
export const OFFLINE_TILE_MIN_ZOOM = 0;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface OfflineTilePlan {
  tiles: TileCoord[];
  /** Highest zoom actually included in the plan. */
  maxZoom: number;
  /** True when the preferred max zoom was reduced to satisfy the tile budget. */
  reduced: boolean;
}

export interface OfflineTilePlanOptions {
  maxTiles?: number;
  minZoom?: number;
  preferredMaxZoom?: number;
}

/** Convert lat/lng to tile coordinates at a given zoom level. */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Get all tile coordinates covering a bounding box across zoom levels. */
export function getTilesForBounds(
  bounds: Region['bounds'],
  minZoom: number,
  maxZoom: number,
): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const topLeft = latLngToTile(bounds.maxLat, bounds.minLng, z);
    const bottomRight = latLngToTile(bounds.minLat, bounds.maxLng, z);
    for (let x = topLeft.x; x <= bottomRight.x; x++) {
      for (let y = topLeft.y; y <= bottomRight.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/**
 * Build a conformant tile plan for a region.
 *
 * @throws when the smallest allowed zoom still exceeds `maxTiles`; callers
 *   must surface this instead of starting an over-limit download.
 */
export function planOfflineTileDownload(
  bounds: Region['bounds'],
  options: OfflineTilePlanOptions = {},
): OfflineTilePlan {
  const maxTiles = options.maxTiles ?? OPENFREEMAP_MAX_TILES_PER_DOWNLOAD;
  const minZoom = options.minZoom ?? OFFLINE_TILE_MIN_ZOOM;
  const preferredMaxZoom = options.preferredMaxZoom ?? OFFLINE_TILE_MAX_ZOOM;

  for (let maxZoom = preferredMaxZoom; maxZoom >= minZoom; maxZoom--) {
    const tiles = getTilesForBounds(bounds, minZoom, maxZoom);
    if (tiles.length <= maxTiles) {
      return { tiles, maxZoom, reduced: maxZoom !== preferredMaxZoom };
    }
  }

  throw new Error(
    `Region is too large for an offline download (over ${maxTiles.toLocaleString()} tiles even at zoom ${minZoom}). Download a smaller area.`,
  );
}
