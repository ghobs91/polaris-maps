/**
 * Signed, content-addressed shard manifests (Tier 1).
 *
 * The contract: mirrors are untrusted, so a shard is only used when its bytes
 * hash to the signed manifest. A lying mirror must cost a retry, never a
 * corrupt index.
 */

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import { schnorr } from '@noble/curves/secp256k1';

import {
  ShardVerificationError,
  createShardManifest,
  fetchVerifiedShard,
  preferPeerSources,
  sha256Hex,
  shardForPoint,
  shardsForBounds,
  verifyShardBytes,
  verifyShardManifest,
  type ShardDescriptor,
  type ShardManifestCore,
} from '../../src/services/regions/shardManifest';

const encoder = new TextEncoder();

function pubkeyHex(privateKey: Uint8Array): string {
  return Array.from(schnorr.getPublicKey(privateKey))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function descriptor(bytes: Uint8Array, overrides: Partial<ShardDescriptor> = {}): ShardDescriptor {
  return {
    shardId: 's2:1b2c',
    path: 'shards/1b2c.pois',
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    merkleRoot: 'a'.repeat(64),
    south: 40.7,
    west: -74.0,
    north: 40.8,
    east: -73.9,
    poiCount: 42,
    ...overrides,
  };
}

function coreFor(shards: ShardDescriptor[], publisherPubkey: string): ShardManifestCore {
  return {
    regionId: 'nyc',
    version: '2.1',
    packContentHash: 'b'.repeat(64),
    shards,
    publisherPubkey,
  };
}

describe('shard byte verification', () => {
  const payload = encoder.encode('poi-bytes');

  it('accepts a payload matching the committed hash and length', () => {
    expect(verifyShardBytes(payload, descriptor(payload))).toBe(true);
  });

  it('rejects a payload with a different hash', () => {
    expect(verifyShardBytes(encoder.encode('poi-bytez'), descriptor(payload))).toBe(false);
  });

  it('rejects a payload with the right prefix but wrong length', () => {
    const longer = encoder.encode('poi-bytes-and-more');
    expect(verifyShardBytes(longer, descriptor(payload))).toBe(false);
  });
});

describe('fetchVerifiedShard', () => {
  const real = encoder.encode('real-shard');
  const desc = descriptor(real);

  it('returns the first source whose bytes verify', async () => {
    const peer = jest.fn(async () => real);
    const bytes = await fetchVerifiedShard(desc, [
      { kind: 'peer', label: 'peer-a', read: async () => encoder.encode('garbage') },
      { kind: 'peer', label: 'peer-b', read: peer },
    ]);

    expect(new TextDecoder().decode(bytes)).toBe('real-shard');
    expect(peer).toHaveBeenCalledTimes(1);
  });

  it('falls through a lying mirror to the next source', async () => {
    const bytes = await fetchVerifiedShard(desc, [
      { kind: 'peer', label: 'liar', read: async () => encoder.encode('tampered') },
      { kind: 'peer', label: 'honest', read: async () => real },
    ]);
    expect(new TextDecoder().decode(bytes)).toBe('real-shard');
  });

  it('throws when no source produces a matching shard', async () => {
    await expect(
      fetchVerifiedShard(desc, [
        { kind: 'peer', label: 'a', read: async () => encoder.encode('nope') },
        {
          kind: 'peer',
          label: 'b',
          read: async () => {
            throw new Error('offline');
          },
        },
      ]),
    ).rejects.toBeInstanceOf(ShardVerificationError);
  });

  it('tries peer sources before HTTP archives by default', async () => {
    const order: string[] = [];
    const httpSource = {
      kind: 'http' as const,
      url: 'https://archive.example.org/shard',
    };
    global.fetch = jest.fn(async () => {
      order.push('http');
      return {
        ok: true,
        arrayBuffer: async () => real.slice().buffer,
        headers: new Headers(),
      };
    }) as unknown as typeof fetch;

    await fetchVerifiedShard(desc, [
      httpSource,
      {
        kind: 'peer',
        label: 'seeding-peer',
        read: async () => {
          order.push('peer');
          return real;
        },
      },
    ]);

    // The peer had the bytes, so the archive was never asked.
    expect(order).toEqual(['peer']);
  });

  it('falls back to a community archive when no peer has the shard', async () => {
    const http = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => real.slice().buffer,
      headers: new Headers(),
    }));
    global.fetch = http as unknown as typeof fetch;

    const bytes = await fetchVerifiedShard(desc, [
      {
        kind: 'peer',
        label: 'offline-peer',
        read: async () => {
          throw new Error('no peers');
        },
      },
      { kind: 'http', url: 'https://archive.example.org/shard' },
    ]);

    expect(new TextDecoder().decode(bytes)).toBe('real-shard');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('surfaces a caller abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchVerifiedShard(desc, [{ kind: 'peer', label: 'a', read: async () => real }], {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe('shard manifest signing', () => {
  const privateKey = schnorr.utils.randomPrivateKey();
  const publisherPubkey = pubkeyHex(privateKey);

  it('verifies a manifest signed by a trusted publisher', async () => {
    const shards = [descriptor(encoder.encode('one')), descriptor(encoder.encode('two'))];
    const manifest = await createShardManifest(coreFor(shards, publisherPubkey), privateKey);

    expect(verifyShardManifest(manifest, [publisherPubkey])).toBe(true);
  });

  it('rejects an untrusted publisher', async () => {
    const manifest = await createShardManifest(
      coreFor([descriptor(encoder.encode('one'))], publisherPubkey),
      privateKey,
    );
    expect(verifyShardManifest(manifest, ['c'.repeat(64)])).toBe(false);
  });

  it('rejects a manifest whose shard list was edited after signing', async () => {
    const shards = [descriptor(encoder.encode('one'))];
    const manifest = await createShardManifest(coreFor(shards, publisherPubkey), privateKey);

    manifest.shards[0]!.poiCount = 1_000_000;
    expect(verifyShardManifest(manifest, [publisherPubkey])).toBe(false);
  });

  it('rejects malformed shard descriptors even when validly signed', async () => {
    const bad = descriptor(encoder.encode('one'), { sha256: 'not-hex' });
    const manifest = await createShardManifest(coreFor([bad], publisherPubkey), privateKey);
    expect(verifyShardManifest(manifest, [publisherPubkey])).toBe(false);
  });
});

describe('preferPeerSources', () => {
  it('keeps relative order inside each kind', () => {
    const sources = [
      { kind: 'http' as const, url: 'https://a.example.org/x' },
      { kind: 'peer' as const, label: 'p1', read: async () => new Uint8Array() },
      { kind: 'http' as const, url: 'https://b.example.org/x' },
      { kind: 'peer' as const, label: 'p2', read: async () => new Uint8Array() },
    ];
    expect(preferPeerSources(sources).map((s) => (s.kind === 'peer' ? s.label : s.url))).toEqual([
      'p1',
      'p2',
      'https://a.example.org/x',
      'https://b.example.org/x',
    ]);
  });
});

describe('shard selection', () => {
  const shards = [
    descriptor(encoder.encode('a'), { shardId: 'north', south: 40.8, north: 40.9 }),
    descriptor(encoder.encode('b'), { shardId: 'south', south: 40.7, north: 40.8 }),
  ];

  it('finds the shard containing a point', () => {
    expect(shardForPoint(shards, 40.85, -73.95)?.shardId).toBe('north');
    expect(shardForPoint(shards, 40.75, -73.95)?.shardId).toBe('south');
    expect(shardForPoint(shards, 51.5, -0.12)).toBeNull();
  });

  it('finds every shard intersecting a viewport', () => {
    expect(
      shardsForBounds(shards, { south: 40.75, west: -74, north: 40.95, east: -73.9 }),
    ).toHaveLength(2);
    expect(
      shardsForBounds(shards, { south: 40.81, west: -74, north: 40.95, east: -73.9 }).map(
        (s) => s.shardId,
      ),
    ).toEqual(['north']);
  });
});
