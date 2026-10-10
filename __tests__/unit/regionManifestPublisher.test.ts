jest.mock('expo-secure-store', () => ({}));
jest.mock('../../src/services/sync/hyperdriveBridge', () => ({ seedRegion: jest.fn() }));
jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));

import { schnorr } from '@noble/curves/secp256k1';
import { seedRegion } from '../../src/services/sync/hyperdriveBridge';
import { getOrCreateKeypair } from '../../src/services/identity/keypair';
import { publishRegionPack } from '../../src/services/regions/regionManifestPublisher';
import { verifyRegionManifest } from '../../src/services/regions/regionManifest';

const seedRegionMock = seedRegion as jest.Mock;
const keypairMock = getOrCreateKeypair as jest.Mock;

let publicKey: string;

beforeEach(() => {
  jest.clearAllMocks();
  const privateKey = schnorr.utils.randomPrivateKey();
  publicKey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex');
  keypairMock.mockResolvedValue({ privateKey, publicKey });
});

describe('publishRegionPack', () => {
  it('authors a pack and returns a signed manifest', async () => {
    seedRegionMock.mockResolvedValue({
      key: 'a'.repeat(64),
      discoveryKey: 'b'.repeat(64),
      readOnly: false,
      contentHash: 'c'.repeat(64),
      bytes: 4242,
    });

    const manifest = await publishRegionPack({
      regionId: 'us-ny-new-york',
      filesDir: '/data/regions/us-ny-new-york/',
      version: '1.0',
      overtureRelease: '2026-09-23.1',
    });

    expect(manifest.regionId).toBe('us-ny-new-york');
    expect(manifest.driveKey).toBe('a'.repeat(64));
    expect(manifest.discoveryKey).toBe('b'.repeat(64));
    expect(manifest.contentHash).toBe('c'.repeat(64));
    expect(manifest.bytes).toBe(4242);
    expect(manifest.publisherPubkey).toBe(publicKey);
    expect(verifyRegionManifest(manifest, [publicKey])).toBe(true);
  });

  it('rejects when the pack is already seeded read-only', async () => {
    seedRegionMock.mockResolvedValue({
      key: 'a'.repeat(64),
      discoveryKey: 'b'.repeat(64),
      readOnly: true,
    });

    await expect(
      publishRegionPack({
        regionId: 'us-ny-new-york',
        filesDir: '/data/regions/us-ny-new-york/',
        version: '1.0',
        overtureRelease: null,
      }),
    ).rejects.toThrow(/read-only/i);
  });

  it('rejects when authoring returns no content hash', async () => {
    seedRegionMock.mockResolvedValue({
      key: 'a'.repeat(64),
      discoveryKey: 'b'.repeat(64),
      readOnly: false,
      bytes: 1,
    });

    await expect(
      publishRegionPack({
        regionId: 'us-ny-new-york',
        filesDir: '/data/regions/us-ny-new-york/',
        version: '1.0',
        overtureRelease: null,
      }),
    ).rejects.toThrow(/content hash/i);
  });
});
