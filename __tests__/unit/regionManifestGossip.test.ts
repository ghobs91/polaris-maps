import { schnorr } from '@noble/curves/secp256k1';

const mockStorage = new Map<string, string>();
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
  },
}));

import {
  createRegionManifest,
  type RegionManifest,
} from '../../src/services/regions/regionManifest';
import {
  ingestManifest,
  loadPersistedManifests,
  persistManifests,
  publishRegionManifest,
  startRegionManifestGossip,
} from '../../src/services/regions/regionManifestGossip';
import {
  clearRegionManifestCache,
  getRegionManifest,
  setRemoteRegionManifests,
  __setTrustedRegionPublishersForTests,
} from '../../src/services/regions/regionManifestResolver';

function makeKeypair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = schnorr.utils.randomPrivateKey();
  return { privateKey, publicKey: Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex') };
}

async function makeManifest(
  regionId: string,
  publisherPubkey: string,
  privateKey: Uint8Array,
  overrides: Partial<RegionManifest> = {},
): Promise<RegionManifest> {
  return createRegionManifest(
    {
      regionId,
      version: '1.0',
      overtureRelease: null,
      driveKey: 'a'.repeat(64),
      discoveryKey: 'b'.repeat(64),
      contentHash: 'c'.repeat(64),
      bytes: 1,
      publisherPubkey,
      ...overrides,
    },
    privateKey,
  );
}

function createFakeGun() {
  const puts: Array<{ path: string; value: unknown }> = [];
  let onCb: ((value: unknown, key: string) => void) | null = null;
  const node = (path: string): any => ({
    get: (key: string) => node(path ? `${path}/${key}` : key),
    put: (value: unknown) => puts.push({ path, value }),
    map: () => node(path),
    on: (cb: (value: unknown, key: string) => void) => {
      onCb = cb;
    },
  });
  return { gun: node(''), puts, emit: (value: unknown) => onCb?.(value, 'k') };
}

beforeEach(() => {
  mockStorage.clear();
  setRemoteRegionManifests([]);
  clearRegionManifestCache();
  __setTrustedRegionPublishersForTests(null);
});

afterEach(() => {
  __setTrustedRegionPublishersForTests(null);
});

describe('regionManifestGossip', () => {
  it('publishes to the region/publisher namespace path', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await makeManifest('us-ny-new-york', publicKey, privateKey);
    const fake = createFakeGun();

    publishRegionManifest(fake.gun, manifest);

    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0].path).toBe(`polaris/region-manifests/us-ny-new-york/${publicKey}`);
    expect(fake.puts[0].value).toMatchObject({ regionId: 'us-ny-new-york' });
  });

  it('ingests a verified manifest and rejects tampered/untrusted ones', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await makeManifest('us-ny-new-york', publicKey, privateKey);

    expect(ingestManifest([], manifest, [publicKey])).toHaveLength(1);

    const tampered = { ...manifest, driveKey: 'f'.repeat(64) };
    expect(ingestManifest([], tampered, [publicKey])).toBeNull();

    const other = makeKeypair();
    expect(ingestManifest([], manifest, [other.publicKey])).toBeNull();
  });

  it('verifies, merges, persists, and relays through the live subscription', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const manifest = await makeManifest('us-ny-new-york', publicKey, privateKey);

    const fake = createFakeGun();
    startRegionManifestGossip(fake.gun, [publicKey]);
    __setTrustedRegionPublishersForTests([publicKey]);

    fake.emit({ ...manifest, _: { '#': 'gunmeta' } });

    expect(getRegionManifest('us-ny-new-york')?.driveKey).toBe(manifest.driveKey);
    expect(loadPersistedManifests().some((m) => m.regionId === 'us-ny-new-york')).toBe(true);
    // Relayed back to the namespace (publish called for the incoming manifest).
    expect(fake.puts.some((p) => p.path.includes('us-ny-new-york'))).toBe(true);
  });

  it('persists the newest manifest per publisher and survives a reload', async () => {
    const { privateKey, publicKey } = makeKeypair();
    const v1 = await makeManifest('us-ny-new-york', publicKey, privateKey, { version: '1.0' });
    const v2 = await makeManifest('us-ny-new-york', publicKey, privateKey, { version: '2.0' });

    persistManifests([v1, v2]);

    const loaded = loadPersistedManifests();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].version).toBe('2.0');
  });
});
