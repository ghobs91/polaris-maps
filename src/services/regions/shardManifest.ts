/**
 * Signed, content-addressed shard manifests (Tier 1 of the Overpass replacement).
 *
 * A region pack is large; a user who pans into an uncovered area needs a few
 * hundred kilobytes of POI data, not a download. Shards split the base snapshot
 * into cells that can be fetched independently — from a peer seeding the pack
 * over Hyperdrive/Hyperswarm, or from a community archive — and every shard is
 * committed by its SHA-256, so sources are interchangeable and untrusted:
 *
 * - Polaris operates no CDN, backend, or origin. Shards live inside the region
 *   pack (already replicated peer-to-peer); any HTTP source is a community or
 *   third-party archive, and the feature works with none of them available.
 *
 * - A shard that does not hash to the manifest is discarded, not used. A lying
 *   mirror can only cause a retry against the next source.
 * - The manifest itself is signed by the same publisher keys trusted for region
 *   packs ({@link isTrustedPublisher}), so the trust anchor is unchanged.
 * - Each shard also carries a `merkleRoot` over its POIs, which is what makes a
 *   *peer-computed* answer verifiable (`verifiableShardIndex`).
 *
 * This is deliberately NOT a query service: nothing in this path evaluates
 * OverpassQL in the network. Data is distributed; computation stays local.
 */

import { sha256 } from '@noble/hashes/sha256';
import { createSigningPayload, sign, verify } from '../identity/signing';
import { isTrustedPublisher } from '../regions/regionManifest';
import { TRUSTED_REGION_PUBLISHERS } from '../../constants/regionPublishers';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

export interface ShardDescriptor {
  /** Stable id, e.g. a geohash prefix or S2 cell token. */
  shardId: string;
  /** Path inside the pack (POSIX separators). */
  path: string;
  /** Exact byte length of the shard payload. */
  bytes: number;
  /** SHA-256 (hex) of the payload. Mirrors are verified against this. */
  sha256: string;
  /** Merkle root over the shard's POI entries (see `verifiableShardIndex`). */
  merkleRoot: string;
  south: number;
  west: number;
  north: number;
  east: number;
  poiCount: number;
}

export interface ShardManifestCore {
  regionId: string;
  /** Pack version this shard set belongs to. */
  version: string;
  /** Pack content hash from the region manifest (binds both documents). */
  packContentHash: string;
  shards: ShardDescriptor[];
  publisherPubkey: string;
}

export interface ShardManifest extends ShardManifestCore {
  signature: string;
}

/**
 * A place a shard can be read from.
 *
 * The primary source is the region pack itself: every peer that seeds the pack
 * already holds the shard bytes and serves them over Hyperdrive/Hyperswarm, so
 * that is the `peer` kind. The `http` kind exists for community/third-party
 * archives (the same operators that host the pack origin) — Polaris operates no
 * CDN and no origin of its own, and nothing here requires one to exist.
 *
 * Neither kind is trusted: the payload is hashed before use.
 */
export type ShardSource =
  | { kind: 'http'; url: string; headers?: Record<string, string> }
  | { kind: 'peer'; label: string; read: (signal?: AbortSignal) => Promise<Uint8Array> };

export class ShardVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShardVerificationError';
  }
}

/** Canonical byte string a shard-manifest signature covers. */
export function shardManifestPayload(core: ShardManifestCore): string {
  const shardLines = core.shards
    .map((s) =>
      [
        s.shardId,
        s.path,
        s.bytes,
        s.sha256,
        s.merkleRoot,
        s.south,
        s.west,
        s.north,
        s.east,
        s.poiCount,
      ].join(','),
    )
    .sort()
    .join(';');
  return createSigningPayload(
    core.regionId,
    core.version,
    core.packContentHash,
    core.publisherPubkey,
    shardLines,
  );
}

export async function createShardManifest(
  core: ShardManifestCore,
  privateKey: Uint8Array,
): Promise<ShardManifest> {
  const signature = await sign(shardManifestPayload(core), privateKey);
  return { ...core, signature };
}

/**
 * Verify signature + trusted publisher + internal consistency.
 *
 * Rejects manifests whose shard bytes/hashes are malformed: a zero-length
 * shard, a non-hex hash, or a negative count would otherwise let a malformed
 * (but validly signed) document poison the client.
 */
export function verifyShardManifest(
  manifest: ShardManifest,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): boolean {
  if (
    !manifest.regionId ||
    !manifest.version ||
    !manifest.publisherPubkey ||
    !manifest.signature ||
    !Array.isArray(manifest.shards)
  ) {
    return false;
  }
  if (!isTrustedPublisher(manifest.publisherPubkey, trusted)) return false;

  for (const shard of manifest.shards) {
    if (!shard.shardId || !shard.path) return false;
    if (!(shard.bytes > 0) || !(shard.poiCount >= 0)) return false;
    if (!/^[0-9a-f]{64}$/i.test(shard.sha256)) return false;
    if (!/^[0-9a-f]{64}$/i.test(shard.merkleRoot)) return false;
    if (
      !Number.isFinite(shard.south) ||
      !Number.isFinite(shard.west) ||
      !Number.isFinite(shard.north) ||
      !Number.isFinite(shard.east)
    ) {
      return false;
    }
  }

  return verify(shardManifestPayload(manifest), manifest.signature, manifest.publisherPubkey);
}

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when the payload matches the descriptor's committed hash and length. */
export function verifyShardBytes(bytes: Uint8Array, descriptor: ShardDescriptor): boolean {
  if (bytes.length !== descriptor.bytes) return false;
  return sha256Hex(bytes) === descriptor.sha256.toLowerCase();
}

/** The shard whose box contains the point, if any. */
export function shardForPoint(
  shards: readonly ShardDescriptor[],
  lat: number,
  lng: number,
): ShardDescriptor | null {
  for (const shard of shards) {
    if (lat >= shard.south && lat <= shard.north && lng >= shard.west && lng <= shard.east) {
      return shard;
    }
  }
  return null;
}

/** Shards intersecting a viewport (used to prefetch the tiles a pan will need). */
export function shardsForBounds(
  shards: readonly ShardDescriptor[],
  bounds: { south: number; west: number; north: number; east: number },
): ShardDescriptor[] {
  return shards.filter(
    (shard) =>
      shard.south <= bounds.north &&
      shard.north >= bounds.south &&
      shard.west <= bounds.east &&
      shard.east >= bounds.west,
  );
}

const FETCH_TIMEOUT_MS = 20_000;

async function readHttpSource(
  source: Extract<ShardSource, { kind: 'http' }>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(source.url, {
      headers: { Accept: 'application/octet-stream', ...source.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readSource(source: ShardSource, signal?: AbortSignal): Promise<Uint8Array> {
  if (source.kind === 'http') return readHttpSource(source, signal);
  return source.read(signal);
}

function sourceLabel(source: ShardSource): string {
  return source.kind === 'http' ? source.url : source.label;
}

/**
 * Peer sources first, HTTP archives second.
 *
 * Bandwidth that a seeding peer already has should be used before asking a
 * community archive to serve it again, and it keeps the app functional when no
 * archive is reachable at all.
 */
export function preferPeerSources(sources: readonly ShardSource[]): ShardSource[] {
  return [
    ...sources.filter((source) => source.kind === 'peer'),
    ...sources.filter((source) => source.kind !== 'peer'),
  ];
}

/**
 * Fetch a shard from the first source that returns bytes matching the
 * descriptor's committed hash.
 *
 * Sources are tried in order — peer sources before HTTP archives unless
 * `preferPeers: false` — and a bad hash is a logged, non-fatal failure. This is
 * what lets a shard be served by an untrusted peer or a community mirror:
 * integrity comes from the manifest, not from who answered.
 */
export async function fetchVerifiedShard(
  descriptor: ShardDescriptor,
  sources: readonly ShardSource[],
  opts?: { signal?: AbortSignal; preferPeers?: boolean },
): Promise<Uint8Array> {
  const ordered = opts?.preferPeers === false ? [...sources] : preferPeerSources(sources);
  const failures: string[] = [];
  for (const source of ordered) {
    if (opts?.signal?.aborted) throw new Error('Aborted');
    try {
      const bytes = await readSource(source, opts?.signal);
      if (verifyShardBytes(bytes, descriptor)) return bytes;
      failures.push(`${sourceLabel(source)}: hash mismatch`);
      logDiagnostic('shards', 'warn', 'shard hash mismatch', {
        shardId: descriptor.shardId,
        source: sourceLabel(source),
      });
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
      failures.push(`${sourceLabel(source)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new ShardVerificationError(
    `No source produced shard ${descriptor.shardId} (${failures.join('; ')})`,
  );
}
