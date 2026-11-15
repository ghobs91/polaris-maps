/**
 * When the region downloader should spend time asking the P2P mesh first.
 *
 * The mesh attempt is not cheap: `downloadFromPeers` waits up to
 * `TRANSFER_TIMEOUT_MS` (120 s) for a seeder to answer. Once a peer is there
 * that is a fine price for a canonical, origin-free pack. With no peers it is
 * longer than the HTTP download takes — and because a reload inside that window
 * leaves the region with only its first asset (and the orphan sweep resets
 * `download_status` to `none`), it also looks like the download silently did
 * nothing. That is exactly what happened on a simulator with no peers: New York
 * Metro sat at `tiles.pmtiles`, 4 MB of a 92 MB pack, with no routing graph, on
 * repeated attempts.
 *
 * Pure and free of native imports so the policy is unit tested directly.
 */

export interface PeerDownloadDecisionInput {
  /** Canonical drive key, when one is known (bundled or verified manifest). */
  canonicalKey: string | null;
  /** Peers currently connected to the mesh, per the peer monitor. */
  peersConnected: boolean;
  /**
   * Whether the pack can be fetched without the mesh (a published asset
   * manifest, or the legacy per-tile path). Without one, P2P is the only way to
   * get the region, so it is attempted even with no peers visible.
   */
  hasHttpFallback: boolean;
}

/** True when the P2P attempt is worth making before falling back to HTTP. */
export function shouldTryPeerDownload(input: PeerDownloadDecisionInput): boolean {
  if (!input.canonicalKey) return false;
  if (input.peersConnected) return true;
  return !input.hasHttpFallback;
}
