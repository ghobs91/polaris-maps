/**
 * Whether a cold traffic tile should spend time asking the mesh before TomTom.
 *
 * The peer attempt is cheap per tile but it is *serialised* against the origin
 * fetch, so its cost is paid by every tile in the viewport at once: at
 * concurrency 6 and ~18 tiles that is three waves of "wait for the mesh, then
 * ask TomTom", which is what made the raster layer take ~10 s to paint.
 *
 * Two cases make that wait pure loss:
 *
 *   1. **Nobody is connected.** `isSwarmStarted()` only says the worklet booted;
 *      a device with zero peers was still paying the full timeout for a
 *      guaranteed `null` on every cold tile.
 *   2. **The peers do not hold traffic tiles.** Tiles live in a small rolling
 *      disk cache (`MAX_CACHED_TILES`), so misses are the normal case for cells
 *      nobody else has driven. A run of misses means the mesh is not answering
 *      *for this data*, and continuing to stall on it is what turns a 1 s paint
 *      into a 10 s one.
 *
 * A miss streak is reset whenever the peer count changes, because a new set of
 * peers is a new set of caches and is worth asking again.
 *
 * Pure and free of native imports so the policy is unit tested directly, in the
 * same shape as `peerDownloadPolicy` and `packSourcePolicy`.
 */

/** Consecutive peer misses after which cold tiles stop asking the mesh. */
export const PEER_MISS_STREAK_LIMIT = 8;

export interface PeerTileQueryDecisionInput {
  /** Peers currently connected to the traffic swarm. */
  peersConnected: number;
  /** Whether the Hyperswarm worklet has started (it may have zero peers). */
  swarmStarted: boolean;
  /** Consecutive cold-tile peer queries that came back empty. */
  missStreak: number;
}

/** True when a cold tile is worth a peer round-trip before falling back. */
export function shouldQueryPeersForTile(input: PeerTileQueryDecisionInput): boolean {
  if (!input.swarmStarted) return false;
  if (input.peersConnected <= 0) return false;
  return input.missStreak < PEER_MISS_STREAK_LIMIT;
}

/**
 * Update the miss streak after a peer query.
 *
 * A hit clears it (the mesh holds this class of data); a miss extends it. The
 * streak is capped so it cannot grow without bound while peers stay connected to
 * a swarm that never answers.
 */
export function nextPeerMissStreak(current: number, hit: boolean): number {
  if (hit) return 0;
  return Math.min(current + 1, PEER_MISS_STREAK_LIMIT);
}

/**
 * The miss streak to carry into the next query after the peer count changed.
 *
 * Topology change means different caches on the other side, so the previous
 * streak is no longer evidence about this swarm.
 */
export function resetPeerMissStreak(
  previousCount: number,
  nextCount: number,
  streak: number,
): number {
  return previousCount === nextCount ? streak : 0;
}
