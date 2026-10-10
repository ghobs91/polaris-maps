/**
 * Signed region manifests.
 *
 * A region pack is a content-addressed Hyperdrive identified by a canonical
 * `driveKey`. The manifest is the trust root: it binds a region to that key and
 * is signed by a trusted publisher, so every peer can verify they are seeding
 * the same pack. Keys are sourced from a bundled manifest (shipped in the app)
 * and, optionally, verified remote entries.
 *
 * See `openspec/changes/add-canonical-region-seeding/` for the full design.
 */

import { sha256 } from '@noble/hashes/sha256';
import { createSigningPayload, sign, verify } from '../identity/signing';
import { TRUSTED_REGION_PUBLISHERS } from '../../constants/regionPublishers';

/** A signed pointer to a region pack's canonical Hyperdrive. */
export interface RegionManifest {
  regionId: string;
  /** Pack/data version (bumped when the pack contents change). */
  version: string;
  /** Overture release the pack's places were derived from, when applicable. */
  overtureRelease: string | null;
  /** Canonical Hyperdrive writer key (hex). Identical for every seeder. */
  driveKey: string;
  /** Discovery key peers join to find seeders of this pack (hex). */
  discoveryKey: string;
  /** SHA-256 (hex) over the pack's sorted file index, for reproducible builds. */
  contentHash: string;
  /** Total packed size in bytes. */
  bytes: number;
  /** Publisher public key (x-only secp256k1, hex). */
  publisherPubkey: string;
  /** Schnorr signature (hex) over {@link regionManifestPayload}. */
  signature: string;
}

/** A manifest without its signature (what gets signed). */
export type RegionManifestCore = Omit<RegionManifest, 'signature'>;

/** A single entry in a pack's content index. */
export interface PackIndexEntry {
  /** Path relative to the pack root (POSIX separators). */
  path: string;
  size: number;
}

/**
 * Canonical byte string a manifest signature covers. Field order is fixed and
 * MUST NOT change without a manifest version bump (it would invalidate every
 * existing signature).
 */
export function regionManifestPayload(core: RegionManifestCore): string {
  return createSigningPayload(
    core.regionId,
    core.version,
    core.overtureRelease ?? '',
    core.driveKey,
    core.discoveryKey,
    core.contentHash,
    core.bytes,
    core.publisherPubkey,
  );
}

/** Sign a manifest core with the given private key. */
export async function createRegionManifest(
  core: RegionManifestCore,
  privateKey: Uint8Array,
): Promise<RegionManifest> {
  const signature = await sign(regionManifestPayload(core), privateKey);
  return { ...core, signature };
}

/** True when `pubkey` is in the trusted publisher set (case-insensitive). */
export function isTrustedPublisher(
  pubkey: string,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): boolean {
  const normalized = pubkey.trim().toLowerCase();
  return normalized.length > 0 && trusted.some((k) => k.trim().toLowerCase() === normalized);
}

/**
 * Verify a manifest's signature and that its publisher is trusted.
 *
 * Returns false for missing/invalid fields, an untrusted publisher, or a bad
 * signature — callers MUST NOT trust a `driveKey` unless this returns true.
 */
export function verifyRegionManifest(
  manifest: RegionManifest,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): boolean {
  if (
    !manifest.regionId ||
    !manifest.driveKey ||
    !manifest.publisherPubkey ||
    !manifest.signature
  ) {
    return false;
  }
  if (!isTrustedPublisher(manifest.publisherPubkey, trusted)) return false;
  return verify(regionManifestPayload(manifest), manifest.signature, manifest.publisherPubkey);
}

/**
 * Deterministic content hash over a pack's file index: SHA-256 (hex) of the
 * sorted `path\0size` lines. Independent of filesystem ordering so two devices
 * that assemble the same pack compute the same hash.
 */
export function computePackContentHash(entries: readonly PackIndexEntry[]): string {
  const canonical = [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => `${entry.path}\u0000${entry.size}`)
    .join('\n');
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Resolve the effective canonical manifest per region.
 *
 * The bundled manifest is the compiled-in root of trust, so it always wins for
 * its regions. Remote entries are trusted only when their signature verifies
 * against `trusted`; they may fill regions the bundle does not cover but never
 * override a bundled entry.
 */
export function mergeRegionManifests(
  bundled: readonly RegionManifest[],
  remote: readonly RegionManifest[] = [],
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): Map<string, RegionManifest> {
  const resolved = new Map<string, RegionManifest>();
  for (const manifest of bundled) {
    resolved.set(manifest.regionId, manifest);
  }
  for (const manifest of remote) {
    if (resolved.has(manifest.regionId)) continue;
    if (!verifyRegionManifest(manifest, trusted)) continue;
    resolved.set(manifest.regionId, manifest);
  }
  return resolved;
}
