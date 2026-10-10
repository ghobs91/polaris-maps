import type { RegionManifest } from '../services/regions/regionManifest';

/**
 * Bundled region manifests — the compiled-in root of trust for canonical packs.
 *
 * Entries ship inside the app binary, so they are trusted without a signature
 * check. Remote manifests must verify against `TRUSTED_REGION_PUBLISHERS` (see
 * `regionPublishers.ts`) and may only fill regions absent here.
 *
 * Pilot target: `us-ny-new-york`. Populate an entry by running the publishing
 * device's authoring path (seed a pack with no canonical key) and committing the
 * returned manifest.
 */
export const BUNDLED_REGION_MANIFESTS: readonly RegionManifest[] = [];

/** Bundled manifest for a region, or null when none is shipped. */
export function getBundledManifest(regionId: string): RegionManifest | null {
  return BUNDLED_REGION_MANIFESTS.find((manifest) => manifest.regionId === regionId) ?? null;
}
