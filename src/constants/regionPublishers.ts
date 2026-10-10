/**
 * Trusted publishers for signed region manifests.
 *
 * A region manifest advertises the canonical Hyperdrive key for a region pack.
 * The app only trusts a manifest whose signature verifies against one of these
 * public keys (x-only secp256k1, 64 lower-case hex chars — the same key type the
 * app identity uses).
 *
 * The publisher identity is the app identity keypair
 * (`src/services/identity/keypair.ts`): run the app and read `getPublicKey()`
 * on the publishing device, then add that value here.
 *
 * Empty by default (no publisher trusted yet). When empty, `verifyRegionManifest`
 * accepts no signed manifest; bundled manifest entries are still trusted because
 * they ship inside the app binary.
 */
export const TRUSTED_REGION_PUBLISHERS: readonly string[] = [
  // 'TODO: <publisher app-identity public key, 64 hex chars>',
];
