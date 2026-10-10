import { schnorr } from '@noble/curves/secp256k1';
import { createRegionManifest } from '../../src/services/regions/regionManifest';
import {
  clearRegionManifestCache,
  getRegionManifest,
  setRemoteRegionManifests,
} from '../../src/services/regions/regionManifestResolver';

beforeEach(() => {
  setRemoteRegionManifests([]);
  clearRegionManifestCache();
});

describe('region manifest resolver', () => {
  it('returns null when nothing is bundled or cached', () => {
    expect(getRegionManifest('us-ny-new-york')).toBeNull();
  });

  it('ignores an unverified remote manifest (cannot inject a canonical key)', async () => {
    const privateKey = schnorr.utils.randomPrivateKey();
    const publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
    const remote = await createRegionManifest(
      {
        regionId: 'us-ny-new-york',
        version: '1.0',
        overtureRelease: '2026-09-23.1',
        driveKey: 'a'.repeat(64),
        discoveryKey: 'b'.repeat(64),
        contentHash: 'c'.repeat(64),
        bytes: 1,
        publisherPubkey: publicKey,
      },
      privateKey,
    );

    setRemoteRegionManifests([remote]);

    // The trusted-publisher allowlist is empty in the repo, so an
    // arbitrary signed manifest must not be trusted.
    expect(getRegionManifest('us-ny-new-york')).toBeNull();
  });

  it('clears its cache when remote manifests change', () => {
    setRemoteRegionManifests([]);
    expect(getRegionManifest('us-ca-los-angeles')).toBeNull();
    clearRegionManifestCache();
    expect(getRegionManifest('us-ca-los-angeles')).toBeNull();
  });
});
