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
