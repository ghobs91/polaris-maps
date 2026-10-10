/**
 * Publisher-side manifest signing, kept separate from `regionManifest.ts` so the
 * pure verification/merge helpers stay free of the device identity dependency
 * (expo-secure-store).
 */

import { getOrCreateKeypair } from '../identity/keypair';
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
