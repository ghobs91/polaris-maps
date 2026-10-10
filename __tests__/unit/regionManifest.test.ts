// The manifest module imports the identity keypair, which pulls in
// expo-secure-store (unavailable in Node). Mock it so only the pure signing
// helpers are exercised.
jest.mock('expo-secure-store', () => ({}));

import { schnorr } from '@noble/curves/secp256k1';
import {
  compareManifestVersion,
  computePackContentHash,
  createRegionManifest,
  isTrustedPublisher,
  mergeRegionManifests,
  regionManifestPayload,
  selectResolvedManifest,
  verifyRegionManifest,
  type RegionManifest,
  type RegionManifestCore,
} from '../../src/services/regions/regionManifest';

function makeKeypair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = schnorr.utils.randomPrivateKey();
  const publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
  return { privateKey, publicKey };
}

function core(publisherPubkey: string): RegionManifestCore {
  return {
    regionId: 'us-ny-new-york',
    version: '1.0',
    overtureRelease: '2026-09-23.1',
    driveKey: 'a'.repeat(64),
    discoveryKey: 'b'.repeat(64),
    contentHash: 'c'.repeat(64),
    bytes: 1234,
    publisherPubkey,
  };
}

describe('region manifest signing and verification', () => {
  it('accepts a manifest signed by a trusted publisher', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await createRegionManifest(core(publicKey), privateKey);

    expect(verifyRegionManifest(manifest, [publicKey])).toBe(true);
  });

  it('rejects a manifest whose driveKey was tampered with after signing', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await createRegionManifest(core(publicKey), privateKey);
    const tampered: RegionManifest = { ...manifest, driveKey: 'd'.repeat(64) };

    expect(verifyRegionManifest(tampered, [publicKey])).toBe(false);
  });

  it('rejects a manifest from an unknown publisher', async () => {
    const { privateKey } = makeKeypair();
    const { publicKey: otherKey } = makeKeypair();
    const manifest = await createRegionManifest(core(otherKey), privateKey);

    // Signed by `otherKey`? No — core claims otherKey but was signed by the
    // first keypair, so both the publisher check and the signature fail.
    expect(verifyRegionManifest(manifest, [makeKeypair().publicKey])).toBe(false);
  });

  it('rejects a manifest signed by a key not in the trusted set', async () => {
    const signer = makeKeypair();
    const trusted = makeKeypair();
    const manifest = await createRegionManifest(core(signer.publicKey), signer.privateKey);

    expect(verifyRegionManifest(manifest, [trusted.publicKey])).toBe(false);
    expect(verifyRegionManifest(manifest, [signer.publicKey])).toBe(true);
  });

  it('rejects a manifest with no signature', async () => {
    const { publicKey } = makeKeypair();
    const manifest = { ...core(publicKey), signature: '' } as RegionManifest;

    expect(verifyRegionManifest(manifest, [publicKey])).toBe(false);
  });

  it('binds the publisher field into the signed payload', () => {
    const { publicKey } = makeKeypair();
    const { publicKey: other } = makeKeypair();
    expect(regionManifestPayload(core(publicKey))).not.toBe(regionManifestPayload(core(other)));
  });
});

describe('isTrustedPublisher', () => {
  it('matches case-insensitively and trims', () => {
    const { publicKey } = makeKeypair();
    expect(isTrustedPublisher(publicKey.toUpperCase(), [publicKey])).toBe(true);
    expect(isTrustedPublisher(publicKey, ['  ' + publicKey + '  '])).toBe(true);
    expect(isTrustedPublisher(publicKey, ['ffff'])).toBe(false);
    expect(isTrustedPublisher('', [publicKey])).toBe(false);
  });
});

describe('computePackContentHash', () => {
  it('is stable regardless of file order', () => {
    const a = computePackContentHash([
      { path: 'tiles.pmtiles', size: 10 },
      { path: 'routing/graph.tar', size: 20 },
    ]);
    const b = computePackContentHash([
      { path: 'routing/graph.tar', size: 20 },
      { path: 'tiles.pmtiles', size: 10 },
    ]);
    expect(a).toBe(b);
  });

  it('changes when a file size changes', () => {
    const a = computePackContentHash([{ path: 'tiles.pmtiles', size: 10 }]);
    const b = computePackContentHash([{ path: 'tiles.pmtiles', size: 11 }]);
    expect(a).not.toBe(b);
  });
});

describe('mergeRegionManifests', () => {
  it('keeps a bundled entry over a verified remote entry', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const bundled = await createRegionManifest(core(publicKey), privateKey);
    const remote = await createRegionManifest(
      { ...core(publicKey), driveKey: 'e'.repeat(64) },
      privateKey,
    );

    const merged = mergeRegionManifests([bundled], [remote], [publicKey]);
    expect(merged.get('us-ny-new-york')?.driveKey).toBe(bundled.driveKey);
  });

  it('lets a verified remote entry fill a region the bundle does not cover', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const remote = await createRegionManifest(
      { ...core(publicKey), regionId: 'us-ca-los-angeles' },
      privateKey,
    );

    const merged = mergeRegionManifests([], [remote], [publicKey]);
    expect(merged.get('us-ca-los-angeles')?.driveKey).toBe(remote.driveKey);
  });

  it('ignores an unverified remote entry', async () => {
    const signer = makeKeypair();
    const trusted = makeKeypair();
    const remote = await createRegionManifest(
      { ...core(signer.publicKey), regionId: 'us-ca-los-angeles' },
      signer.privateKey,
    );

    const merged = mergeRegionManifests([], [remote], [trusted.publicKey]);
    expect(merged.has('us-ca-los-angeles')).toBe(false);
  });
});

describe('manifest version + quorum resolution', () => {
  it('compares dotted numeric versions', () => {
    expect(compareManifestVersion('1.0', '1.2')).toBe(-1);
    expect(compareManifestVersion('2.0', '1.9')).toBe(1);
    expect(compareManifestVersion('1.0', '1.0')).toBe(0);
  });

  it('accepts a single trusted publisher by default', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await createRegionManifest(core(publicKey), privateKey);
    expect(selectResolvedManifest([manifest], 1)?.driveKey).toBe(manifest.driveKey);
  });

  it('requires distinct publishers to agree on driveKey for a quorum', async () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const ma = await createRegionManifest(core(a.publicKey), a.privateKey);
    const mb = await createRegionManifest(core(b.publicKey), b.privateKey);

    // same default driveKey, two publishers → quorum 2 satisfied
    expect(selectResolvedManifest([ma, mb], 2)?.driveKey).toBe(ma.driveKey);
    // one publisher cannot satisfy quorum 2
    expect(selectResolvedManifest([ma], 2)).toBeNull();
  });

  it('does not pick arbitrarily when trusted publishers conflict at the top version', async () => {
    const a = makeKeypair();
    const b = makeKeypair();
    const ma = await createRegionManifest(
      { ...core(a.publicKey), driveKey: 'd'.repeat(64) },
      a.privateKey,
    );
    const mb = await createRegionManifest(
      { ...core(b.publicKey), driveKey: 'e'.repeat(64) },
      b.privateKey,
    );

    expect(selectResolvedManifest([ma, mb], 1)).toBeNull();
  });

  it('prefers the higher version and ignores the lower', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const v1 = await createRegionManifest(
      { ...core(publicKey), version: '1.0', driveKey: 'd'.repeat(64) },
      privateKey,
    );
    const v2 = await createRegionManifest(
      { ...core(publicKey), version: '2.0', driveKey: 'e'.repeat(64) },
      privateKey,
    );

    expect(selectResolvedManifest([v1, v2], 1)?.driveKey).toBe('e'.repeat(64));
  });
});
