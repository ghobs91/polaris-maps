import type { RegionManifest } from '../services/regions/regionManifest';

/**
 * Bundled region manifests — the compiled-in root of trust for canonical packs.
 *
 * Entries ship inside the app binary, so they are trusted without a signature
 * check. Remote manifests must verify against `TRUSTED_REGION_PUBLISHERS` (see
 * `regionPublishers.ts`) and may only fill regions absent here.
 *
 * The pilot entry was authored + signed on the publisher device via
 * Settings → Developer → Publish Region Manifest.
 */
export const BUNDLED_REGION_MANIFESTS: readonly RegionManifest[] = [
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
];

/** Bundled manifest for a region, or null when none is shipped. */
export function getBundledManifest(regionId: string): RegionManifest | null {
  return BUNDLED_REGION_MANIFESTS.find((manifest) => manifest.regionId === regionId) ?? null;
}
