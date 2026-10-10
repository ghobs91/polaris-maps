/**
 * Resolves the canonical region manifest for a region: the bundled manifest
 * (compiled-in root of trust) merged with any verified remote manifests set at
 * runtime. The download flow consults this to learn the canonical Hyperdrive
 * key for a pack before attempting P2P.
 */

import { BUNDLED_REGION_MANIFESTS } from '../../constants/regionManifests';
import { mergeRegionManifests, type RegionManifest } from './regionManifest';

let remoteManifests: readonly RegionManifest[] = [];
let resolved: Map<string, RegionManifest> | null = null;

/** Replace the runtime remote manifests (verified lazily on merge). */
export function setRemoteRegionManifests(manifests: readonly RegionManifest[]): void {
  remoteManifests = [...manifests];
  resolved = null;
}

/** Canonical manifest for a region, or null when none is known. */
export function getRegionManifest(regionId: string): RegionManifest | null {
  if (!resolved) {
    resolved = mergeRegionManifests(BUNDLED_REGION_MANIFESTS, remoteManifests);
  }
  return resolved.get(regionId) ?? null;
}

/** Drop the cached merge (tests, or after replacing remote manifests). */
export function clearRegionManifestCache(): void {
  resolved = null;
}
