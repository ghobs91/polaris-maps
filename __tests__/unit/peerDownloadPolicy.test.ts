/**
 * When to ask the P2P mesh before HTTP.
 *
 * Regression context: a simulator with no peers waited out the full 120 s
 * transfer timeout before every pack download, so New York Metro never got past
 * its first asset (4 MB of 92 MB) across five attempts, `download_status` was
 * reset to `none` by the orphan sweep on each reload, and no routing graph was
 * ever installed — which surfaced as "on-device Valhalla: no region graph
 * loaded" on every route.
 */

import { shouldTryPeerDownload } from '../../src/services/regions/peerDownloadPolicy';

const base = {
  canonicalKey: 'a'.repeat(64),
  peersConnected: false,
  hasHttpFallback: true,
};

describe('shouldTryPeerDownload', () => {
  it('skips the mesh when no peers are connected and HTTP can serve the pack', () => {
    expect(shouldTryPeerDownload(base)).toBe(false);
  });

  it('uses the mesh as soon as a peer is there', () => {
    expect(shouldTryPeerDownload({ ...base, peersConnected: true })).toBe(true);
  });

  it('still tries the mesh when it is the only way to get the region', () => {
    // No asset manifest and no per-tile path: P2P is all there is.
    expect(shouldTryPeerDownload({ ...base, hasHttpFallback: false })).toBe(true);
  });

  it('never tries the mesh without a canonical drive key', () => {
    expect(shouldTryPeerDownload({ ...base, canonicalKey: null, peersConnected: true })).toBe(
      false,
    );
  });
});
