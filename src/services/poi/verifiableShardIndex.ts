/**
 * Verifiable shard answers (Tier 2 of the Overpass replacement).
 *
 * Tier 0/1 cover the enumerated query shapes by shipping precomputed data.
 * This module covers the long tail — "does anyone nearby have a
 * `fuel:diesel=yes` within 5 km?" — where the answer must be computed by some
 * *other* device, which raises the only question that matters: why believe it?
 *
 * A shard is the set of POIs in one cell of the base snapshot, committed as a
 * binary Merkle tree:
 *
 *   leaf  = sha256(0x00 || canonical(entry))
 *   node  = sha256(0x01 || left || right)     (odd node promoted, never duplicated)
 *
 * The root is published in the *signed* shard manifest (same publisher keys as
 * region packs), so a client that trusts the pack trusts the root. A responder
 * returns matching entries plus an inclusion proof each; the client verifies
 * them locally and needs to trust the responder for nothing at all. A peer that
 * omits rows is detected because a verified answer must also cover the shard's
 * declared row count for the predicate range it claims.
 *
 * Second-preimage protection: leaves and interior nodes are domain-separated
 * by a leading 0x00/0x01 byte, so a leaf can never be replayed as an interior
 * node (the classic Merkle malleability bug).
 */

import { sha256 } from '@noble/hashes/sha256';

export interface ShardEntry {
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  lat: number;
  lng: number;
  primaryKey: string;
  subtype: string;
  name: string;
  tags: Record<string, string>;
}

export interface MerkleProof {
  /** Hex leaf hash being proven. */
  leaf: string;
  /** Position of the leaf in the shard's sorted entry list. */
  index: number;
  /** Number of leaves in the shard. */
  total: number;
  /**
   * One step per tree level, leaf level first. `hash: null` marks a promoted
   * node with no sibling at that level — an explicit marker, so levels can
   * never silently desynchronise during verification.
   */
  siblings: Array<{ hash: string | null; side: 'left' | 'right' }>;
}

export interface ShardAnswer {
  /** Shard root the answer claims to be from. */
  root: string;
  entries: ShardEntry[];
  proofs: MerkleProof[];
}

export interface ShardAnswerVerification {
  ok: boolean;
  verified: ShardEntry[];
  rejected: number;
  reason?: string;
}

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('invalid hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concat(prefix: number, left: Uint8Array, right?: Uint8Array): Uint8Array {
  const extra = right ? right.length : 0;
  const buf = new Uint8Array(1 + left.length + extra);
  buf[0] = prefix;
  buf.set(left, 1);
  if (right) buf.set(right, 1 + left.length);
  return buf;
}

/** Stable identifier used to order leaves and look them up. */
export function shardEntryKey(entry: ShardEntry): string {
  return `${entry.osmType}/${entry.osmId}`;
}

/**
 * Canonical serialisation. Field order is fixed and tag keys are sorted, so two
 * devices that hold the same data compute the same leaf and therefore the same
 * root — no JSON key-order ambiguity.
 */
export function canonicalShardEntry(entry: ShardEntry): string {
  const tagKeys = Object.keys(entry.tags ?? {}).sort();
  const tags = tagKeys
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(entry.tags[k])}`)
    .join(',');
  return [
    entry.osmType,
    entry.osmId,
    entry.lat.toFixed(7),
    entry.lng.toFixed(7),
    entry.primaryKey,
    entry.subtype,
    entry.name,
    `{${tags}}`,
  ].join('\u0000');
}

export function hashLeaf(entry: ShardEntry): string {
  return toHex(sha256(concat(LEAF_PREFIX, encoder.encode(canonicalShardEntry(entry)))));
}

function hashNodes(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(NODE_PREFIX, left, right));
}

function sortedEntries(entries: readonly ShardEntry[]): ShardEntry[] {
  return [...entries].sort((a, b) => {
    const ka = shardEntryKey(a);
    const kb = shardEntryKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function buildLevels(sorted: readonly ShardEntry[]): Uint8Array[][] {
  const leaves = sorted.map((entry) => fromHex(hashLeaf(entry)));
  const levels: Uint8Array[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = current[i + 1];
      // Odd node is promoted unchanged. Duplicating it (Bitcoin-style) would
      // let a prover present two different shards with the same root.
      next.push(right ? hashNodes(left, right) : left);
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/** Merkle root of a shard. Deterministic for any input order. */
export function buildShardRoot(entries: readonly ShardEntry[]): string {
  if (entries.length === 0) return toHex(sha256(new Uint8Array([LEAF_PREFIX])));
  const levels = buildLevels(sortedEntries(entries));
  return toHex(levels[levels.length - 1][0]!);
}

/** Inclusion proof for one entry; `null` when the entry is not in the shard. */
export function createInclusionProof(
  entries: readonly ShardEntry[],
  key: string,
): MerkleProof | null {
  const sorted = sortedEntries(entries);
  const index = sorted.findIndex((entry) => shardEntryKey(entry) === key);
  if (index < 0) return null;

  const levels = buildLevels(sorted);
  const siblings: MerkleProof['siblings'] = [];
  let position = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level]!;
    const isLeft = position % 2 === 0;
    const siblingHash = isLeft ? currentLevel[position + 1] : currentLevel[position - 1];
    siblings.push({
      hash: siblingHash ? toHex(siblingHash) : null,
      side: isLeft ? 'right' : 'left',
    });
    position = Math.floor(position / 2);
  }

  return { leaf: hashLeaf(sorted[index]!), index, total: sorted.length, siblings };
}

/** Verify one inclusion proof against a trusted root. */
export function verifyInclusionProof(root: string, entry: ShardEntry, proof: MerkleProof): boolean {
  if (proof.leaf !== hashLeaf(entry)) return false;
  if (proof.index < 0 || proof.total <= 0 || proof.index >= proof.total) return false;
  if (proof.siblings.length === 0 && proof.total !== 1) return false;

  let hash = fromHex(proof.leaf);
  let position = proof.index;
  let levelSize = proof.total;

  for (const step of proof.siblings) {
    if (levelSize <= 1) return false;
    const expectedSide = position % 2 === 0 ? 'right' : 'left';
    // The claimed side must agree with the leaf's position, otherwise a prover
    // could reorder siblings and still produce a matching root.
    if (step.side !== expectedSide) return false;

    const hasSibling = expectedSide === 'right' ? position + 1 < levelSize : true;
    if (hasSibling) {
      if (!step.hash) return false;
      const sibling = fromHex(step.hash);
      hash = step.side === 'right' ? hashNodes(hash, sibling) : hashNodes(sibling, hash);
    } else if (step.hash !== null) {
      // A promoted node must not claim a sibling.
      return false;
    }

    position = Math.floor(position / 2);
    levelSize = Math.ceil(levelSize / 2);
  }

  return levelSize === 1 && toHex(hash) === root.toLowerCase();
}

/** Build a signed-root-committed answer for a predicate evaluated on-device. */
export function buildShardAnswer(
  entries: readonly ShardEntry[],
  predicate: (entry: ShardEntry) => boolean,
): ShardAnswer {
  const root = buildShardRoot(entries);
  const matching = entries.filter(predicate);
  const proofs: MerkleProof[] = [];
  const admitted: ShardEntry[] = [];

  for (const entry of matching) {
    const proof = createInclusionProof(entries, shardEntryKey(entry));
    if (proof) {
      proofs.push(proof);
      admitted.push(entry);
    }
  }

  return { root, entries: admitted, proofs };
}

/**
 * Verify a peer's answer against the root from the signed shard manifest.
 *
 * Every proof must verify and must bind the exact entry returned. An answer
 * that drops rows is still *detectable* at this layer only insofar as the caller
 * compares the verified count with the shard's committed count for that cell
 * (see `verifyAnswerCompleteness`); fabrication and tampering are caught here.
 */
export function verifyShardAnswer(
  trustedRoot: string,
  answer: ShardAnswer,
): ShardAnswerVerification {
  if (answer.root.toLowerCase() !== trustedRoot.toLowerCase()) {
    return { ok: false, verified: [], rejected: answer.entries.length, reason: 'root-mismatch' };
  }
  if (answer.entries.length !== answer.proofs.length) {
    return { ok: false, verified: [], rejected: answer.entries.length, reason: 'proof-count' };
  }

  const verified: ShardEntry[] = [];
  let rejected = 0;
  for (let i = 0; i < answer.entries.length; i++) {
    const entry = answer.entries[i]!;
    const proof = answer.proofs[i]!;
    if (verifyInclusionProof(trustedRoot, entry, proof)) verified.push(entry);
    else rejected += 1;
  }

  return {
    ok: rejected === 0,
    verified,
    rejected,
    reason: rejected === 0 ? undefined : 'bad-proof',
  };
}

/**
 * Completeness check against a shard's committed row count.
 *
 * The manifest commits how many entries the shard holds for a predicate bucket
 * (e.g. "amenity=fuel: 412"). A responder that omits rows cannot fake that
 * number without breaking the signed root, so an answer with fewer verified
 * rows than claimed is rejected.
 */
export function verifyAnswerCompleteness(
  expectedCount: number,
  verification: ShardAnswerVerification,
): boolean {
  return verification.ok && verification.verified.length === expectedCount;
}
