/**
 * Relay as publisher.
 *
 * The catalog advertises 355 packs but signed manifests for none of them, and a
 * relay can only seed a pack whose canonical Hyperdrive key somebody signed. The
 * relay therefore becomes that somebody:
 *
 *   1. fetch the region's assets from the catalog, verifying each against its md5,
 *   2. author the canonical writable drive from those bytes (the publisher path in
 *      `seed-core`), which fixes the key every later seeder will replicate,
 *   3. sign a manifest binding `regionId -> driveKey` with the relay's identity,
 *   4. publish it to the same gossip namespace devices already read.
 *
 * What that does and does not establish:
 *
 *   - **It does not break content integrity.** Canonical drives are ed25519
 *     writer-signed, every asset was md5-verified against the catalog before it was
 *     authored, and clients still verify per-asset checksums on download. A
 *     malicious relay can serve stale or incomplete bytes; it cannot serve
 *     *different* bytes under the same key.
 *   - **It is user-established trust.** A client accepts these manifests because it
 *     paired with this relay (the QR code), not because a compiled-in allowlist
 *     says so. That is the only way it can work per-user without shipping a private
 *     key or an app release per relay.
 */

import { checkManifest, regionManifestPayload } from './manifests.mjs';

/**
 * Build a manifest core (everything that gets signed).
 *
 * `contentHash` must be the deterministic pack index hash — `computePackIndex` in
 * `seed-core.mjs`, which is byte-identical to `computePackContentHash` in the app.
 */
export function buildManifestCore({
  regionId,
  version,
  driveKey,
  discoveryKey,
  contentHash,
  bytes,
  publisherPubkey,
}) {
  return {
    regionId,
    version: String(version ?? 'unknown'),
    overtureRelease: null,
    driveKey: String(driveKey).toLowerCase(),
    discoveryKey: String(discoveryKey).toLowerCase(),
    contentHash: String(contentHash),
    bytes: Number(bytes) || 0,
    publisherPubkey: String(publisherPubkey).toLowerCase(),
  };
}

/** Sign a manifest core with the relay's identity. Returns the full manifest. */
export async function signManifest(core, privateKey) {
  const { schnorr } = await import('@noble/curves/secp256k1');
  const { sha256 } = await import('@noble/hashes/sha256');
  const digest = sha256(new TextEncoder().encode(regionManifestPayload(core)));
  const signature = Buffer.from(schnorr.sign(digest, privateKey)).toString('hex');
  return { ...core, signature };
}

/**
 * Verify a manifest the relay itself just produced.
 *
 * Belt and braces on purpose: this is the one place where a bug produces a pack
 * every other device will refuse, and the failure surfaces far from here. Checking
 * it at the source turns that into an error message with the offending region id.
 */
export function verifyOwnManifest(manifest, trusted) {
  const check = checkManifest(manifest, trusted);
  return check.ok ? { ok: true, reason: null } : check;
}

/**
 * The manifest path a device reads for a region.
 *
 * Matches `publishRegionManifest` in `src/services/regions/regionManifestGossip.ts`:
 * `polaris / region-manifests / <regionId> / <publisherPubkey>`.
 */
export function manifestGossipPath(manifest) {
  return ['polaris', 'region-manifests', manifest.regionId, manifest.publisherPubkey];
}
