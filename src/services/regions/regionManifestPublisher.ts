/**
 * Publisher-side manifest signing, kept separate from `regionManifest.ts` so the
 * pure verification/merge helpers stay free of the device identity dependency
 * (expo-secure-store).
 */

import { getOrCreateKeypair } from '../identity/keypair';
import { seedRegion } from '../sync/hyperdriveBridge';
import {
  createRegionManifest,
  type RegionManifest,
  type RegionManifestCore,
} from './regionManifest';

/**
 * Sign a manifest with the app identity keypair — used by the publishing device
 * when it authors a canonical pack.
 */
export async function buildRegionManifest(
  core: Omit<RegionManifestCore, 'publisherPubkey'>,
): Promise<RegionManifest> {
  const { privateKey, publicKey } = await getOrCreateKeypair();
  return createRegionManifest({ ...core, publisherPubkey: publicKey }, privateKey);
}

export interface PublishRegionPackOptions {
  regionId: string;
  /** Directory holding the assembled pack files (tiles/routing/geocoding). */
  filesDir: string;
  version: string;
  overtureRelease: string | null;
}

/**
 * Author a canonical pack on this device and return its signed manifest.
 *
 * Seeds the pack (author path), takes the canonical key + pack content hash from
 * the sidecar, and signs a manifest with the app identity. Throws when the pack
 * is already seeded read-only (another device authored it) or the sidecar
 * returned no content hash.
 */
export async function publishRegionPack(opts: PublishRegionPackOptions): Promise<RegionManifest> {
  const seeded = await seedRegion(opts.regionId, opts.filesDir);
  if (seeded.readOnly) {
    throw new Error(
      `Region ${opts.regionId} is already seeded as a read-only replica; cannot author a manifest`,
    );
  }
  if (!seeded.contentHash) {
    throw new Error(`Authoring region ${opts.regionId} did not return a content hash`);
  }

  return buildRegionManifest({
    regionId: opts.regionId,
    version: opts.version,
    overtureRelease: opts.overtureRelease,
    driveKey: seeded.key,
    discoveryKey: seeded.discoveryKey,
    contentHash: seeded.contentHash,
    bytes: seeded.bytes ?? 0,
  });
}
