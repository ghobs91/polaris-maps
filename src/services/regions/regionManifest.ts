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
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
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
 * Compare two manifest versions. Dotted numeric segments compare numerically
 * (`1.0` < `1.2` < `2.0`); non-numeric/odd strings fall back to lexicographic
 * comparison. This is the pinned monotonic encoding for manifest supersede.
 */
export function compareManifestVersion(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const numeric = pa.every((s) => /^\d+$/.test(s)) && pb.every((s) => /^\d+$/.test(s));
  if (numeric) {
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = Number(pa[i] ?? 0);
      const y = Number(pb[i] ?? 0);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministically select the manifest to trust for a region from verified
 * candidates.
 *
 * - Group candidates by `driveKey`; a group is only eligible when at least
 *   `quorum` distinct publishers advertise that same `driveKey`.
 * - Among eligible groups, take the highest `version`.
 * - If more than one eligible group ties at the top version (trusted publishers
 *   disagree), return null — never pick one arbitrarily.
 */
export function selectResolvedManifest(
  candidates: readonly RegionManifest[],
  quorum = 1,
): RegionManifest | null {
  if (candidates.length === 0) return null;
  const minPublishers = Math.max(1, quorum);

  const groups = new Map<string, { publishers: Set<string>; best: RegionManifest }>();
  for (const manifest of candidates) {
    const group = groups.get(manifest.driveKey) ?? {
      publishers: new Set<string>(),
      best: manifest,
    };
    group.publishers.add(manifest.publisherPubkey.trim().toLowerCase());
    if (compareManifestVersion(manifest.version, group.best.version) > 0) {
      group.best = manifest;
    }
    groups.set(manifest.driveKey, group);
  }

  const eligible = [...groups.values()].filter((g) => g.publishers.size >= minPublishers);
  if (eligible.length === 0) return null;

  let topVersion = eligible[0].best.version;
  for (const group of eligible) {
    if (compareManifestVersion(group.best.version, topVersion) > 0) topVersion = group.best.version;
  }
  const topGroups = eligible.filter(
    (g) => compareManifestVersion(g.best.version, topVersion) === 0,
  );
  if (topGroups.length !== 1) return null; // conflicting trusted publishers
  return topGroups[0].best;
}

/**
 * Resolve the effective canonical manifest per region.
 *
 * The bundled manifest is the compiled-in root of trust, so it always wins for
 * its regions. Remote entries are trusted only when their signature verifies
 * against `trusted`; for regions the bundle does not cover they are grouped by
 * `driveKey` and resolved with {@link selectResolvedManifest} (highest version,
 * M-of-N quorum, no arbitrary choice on conflict).
 */
export function mergeRegionManifests(
  bundled: readonly RegionManifest[],
  remote: readonly RegionManifest[] = [],
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
  quorumFor: (regionId: string) => number = () => 1,
): Map<string, RegionManifest> {
  const resolved = new Map<string, RegionManifest>();
  for (const manifest of bundled) {
    resolved.set(manifest.regionId, manifest);
  }

  const byRegion = new Map<string, RegionManifest[]>();
  for (const manifest of remote) {
    if (!verifyRegionManifest(manifest, trusted)) continue;
    const list = byRegion.get(manifest.regionId);
    if (list) list.push(manifest);
    else byRegion.set(manifest.regionId, [manifest]);
  }

  for (const [regionId, candidates] of byRegion) {
    if (resolved.has(regionId)) continue; // bundled wins
    const selected = selectResolvedManifest(candidates, quorumFor(regionId));
    if (selected) resolved.set(regionId, selected);
  }

  return resolved;
}
