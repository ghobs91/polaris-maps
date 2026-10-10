/**
 * Trusted publishers for signed region manifests.
 *
 * A region manifest advertises the canonical Hyperdrive key for a region pack.
 * The app only trusts a manifest whose signature verifies against one of these
 * public keys (x-only secp256k1, 64 lower-case hex chars — the same key type the
 * app identity uses).
 *
 * The publisher identity is the app identity keypair
 * (`src/services/identity/keypair.ts`): read it from the publishing device
 * (Settings → Developer → Identity Public Key) and add it here.
 *
 * Bundled manifest entries ship inside the app binary and are trusted without a
 * signature check; this set gates *remote* manifests (catalog + gossip).
 */
export const TRUSTED_REGION_PUBLISHERS: readonly string[] = [
  // Publisher app-identity public key (pilot device).
  '530601b0fd1879b525079aff4da67ac95315cd4ed6df36c9935b90ad6dcac8fb',
];

/**
 * Optional per-region M-of-N quorum. A region absent here defaults to 1 (any
 * single trusted publisher). Higher values require that many distinct trusted
 * publishers advertise the same `driveKey` before a manifest is trusted.
 *
 * Example: `{ 'us-ny-new-york': 2 }`
 */
export const REGION_MANIFEST_QUORUM: Readonly<Record<string, number>> = {};

/** Required distinct-publisher count for a region (default 1). */
export function getRegionManifestQuorum(regionId: string): number {
  const configured = REGION_MANIFEST_QUORUM[regionId];
  return typeof configured === 'number' && configured > 0 ? configured : 1;
}
