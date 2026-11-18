/**
 * Bundled region manifests — the compiled-in trust root, mirrored from the app.
 *
 * `src/constants/regionManifests.ts` ships these inside the iOS binary and trusts
 * them without a signature check. The desktop has no binary to ship them in, so the
 * relay carries the same list and does verify the signature as well: if a bundled
 * entry were corrupted in transit through a copy-paste, the relay should notice
 * rather than seed a key nobody else agrees with.
 *
 * `relay/test/manifests.test.mjs` parses the TypeScript constant and fails if the
 * two lists ever disagree, because a publisher or region added in the app must not
 * silently leave the desktop unable to seed it.
 */

/** Mirrors `BUNDLED_REGION_MANIFESTS` in `src/constants/regionManifests.ts`. */
export const BUNDLED_REGION_MANIFESTS = Object.freeze([
  {
    regionId: 'north-america-us-new-york',
    version: '1.0',
    overtureRelease: null,
    driveKey: 'ae49c8f0526445ade476c5f73656113fab4f6146b0fef56ee766e5a632aee712',
    discoveryKey: '2a48911feba8f912b4f209d73578e5b38bb3696b4f19c97a78dab251d4bce4c5',
    contentHash: '0a2e533c677de34f07798ef39c0adae4621c6e8efea66cd578b8a06d29e71fd9',
    bytes: 194194043,
    publisherPubkey: '530601b0fd1879b525079aff4da67ac95315cd4ed6df36c9935b90ad6dcac8fb',
    signature:
      '07c73ca0b7285b6e9f0ce2ef0422463ec5a1cf1cd1dbf132597e08ab05240e22900ff708dc585a4431e4bbbf564843d39511792b5085b3af0338be51e5050dd8',
  },
]);
