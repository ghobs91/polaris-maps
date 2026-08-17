/**
 * P2P traffic tile exchange types.
 *
 * Tiles are the TomTom flow raster PNGs (256×256) keyed by z/x/y. Peers
 * request tiles they need and respond with base64-encoded PNG bytes. Tile
 * payloads are size-capped to keep the swarm messages small.
 */

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

/** Compact wire payload for a traffic tile. */
export interface WireTilePayload {
  z: number;
  x: number;
  y: number;
  /** Base64-encoded PNG bytes. */
  b64: string;
}

/** Max raw PNG bytes a peer will share per tile (~48 KB). */
export const MAX_TILE_BYTES = 48 * 1024;

/** Max base64 payload length (48 KB × 4/3). */
export const MAX_TILE_B64_LENGTH = 64 * 1024;

/** How long to wait for peer tile responses. */
export const TILE_QUERY_TIMEOUT_MS = 3_000;

/** How many tiles we keep in the local disk cache. */
export const MAX_CACHED_TILES = 2_000;

/** Cache freshness: tiles older than this are refetched from peers/TomTom. */
export const TILE_MAX_AGE_SEC = 15 * 60;

export function tileKeyToString(key: TileKey): string {
  return `${key.z}/${key.x}/${key.y}`;
}

export function tileKeyFromString(key: string): TileKey {
  const [z, x, y] = key.split('/').map(Number);
  return { z, x, y };
}
