/**
 * Shard answer construction for the Bare worklet.
 *
 * Runs inside the Hyperdrive worklet (Bare runtime), where a peer already holds
 * the region pack it seeds. That makes it the natural place to answer a shard
 * query: read `shards/<cell>.jsonl` out of the drive it already replicates,
 * filter it, and return the matching rows with Merkle inclusion proofs.
 *
 * This file is deliberately pure — no Bare, no Hyperdrive, no filesystem — so
 * `scripts/verify-shard-answer.mjs` can run it under Node and compare its output
 * with the app's verifier (`src/services/poi/verifiableShardIndex.ts`). If the
 * two ever disagree by a byte, every answer would be rejected on device.
 *
 * Keep the canonical encoding, leaf/node hashing, odd-node promotion, and proof
 * layout byte-identical to the TypeScript implementation.
 */

import { sha256 } from './node_modules/@noble/hashes/sha256.js';

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(hex) {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function concatPrefix(prefix, left, right) {
  const out = new Uint8Array(1 + left.length + (right ? right.length : 0));
  out[0] = prefix;
  out.set(left, 1);
  if (right) out.set(right, 1 + left.length);
  return out;
}

/** Stable ordering key; must match `shardEntryKey`. */
export function entryKey(entry) {
  return `${entry.osmType}/${entry.osmId}`;
}

/** Canonical serialisation; must match `canonicalShardEntry`. */
export function canonicalEntry(entry) {
  const tags = entry.tags ?? {};
  const tagText = Object.keys(tags)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(tags[key])}`)
    .join(',');
  return [
    entry.osmType,
    entry.osmId,
    entry.lat.toFixed(7),
    entry.lng.toFixed(7),
    entry.primaryKey,
    entry.subtype,
    entry.name,
    `{${tagText}}`,
  ].join('\u0000');
}

export function hashLeaf(entry) {
  return toHex(sha256(concatPrefix(LEAF_PREFIX, new TextEncoder().encode(canonicalEntry(entry)))));
}

function hashNodes(left, right) {
  return toHex(sha256(concatPrefix(NODE_PREFIX, fromHex(left), fromHex(right))));
}

function sortedEntries(entries) {
  return [...entries].sort((a, b) => {
    const ka = entryKey(a);
    const kb = entryKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function buildLevels(sorted) {
  const levels = [sorted.map((entry) => hashLeaf(entry))];
  let current = levels[0];
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      // Odd node is promoted, never duplicated (duplication would let a prover
      // present two different shards with the same root).
      next.push(current[i + 1] ? hashNodes(current[i], current[i + 1]) : current[i]);
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/** Merkle root of a shard; must match `buildShardRoot`. */
export function buildRoot(entries) {
  if (entries.length === 0) {
    return toHex(sha256(concatPrefix(LEAF_PREFIX, new Uint8Array(0))));
  }
  const levels = buildLevels(sortedEntries(entries));
  return levels[levels.length - 1][0];
}

/** Inclusion proof for one entry; must match `createInclusionProof`. */
export function createProof(entries, key) {
  const sorted = sortedEntries(entries);
  const index = sorted.findIndex((entry) => entryKey(entry) === key);
  if (index < 0) return null;

  const levels = buildLevels(sorted);
  const siblings = [];
  let position = index;
  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level];
    const isLeft = position % 2 === 0;
    const sibling = isLeft ? currentLevel[position + 1] : currentLevel[position - 1];
    siblings.push({ hash: sibling ?? null, side: isLeft ? 'right' : 'left' });
    position = Math.floor(position / 2);
  }

  return { leaf: hashLeaf(sorted[index]), index, total: sorted.length, siblings };
}

/** Parse a shard payload (JSONL) into entries. */
export function parseJsonl(text) {
  const entries = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries.push(JSON.parse(trimmed));
  }
  return entries;
}

/** True when an entry satisfies the query predicates; must match the client. */
export function matchesQuery(entry, query) {
  if (query.bounds) {
    const { south, west, north, east } = query.bounds;
    if (entry.lat < south || entry.lat > north || entry.lng < west || entry.lng > east) {
      return false;
    }
  }
  if (Array.isArray(query.keys) && query.keys.length > 0) {
    const matched = query.keys.some(
      (filter) =>
        entry.primaryKey === filter.key &&
        (filter.value === undefined || entry.subtype === filter.value),
    );
    if (!matched) return false;
  }
  for (const [key, value] of query.tags ?? []) {
    if ((entry.tags ?? {})[key] !== value) return false;
  }
  return true;
}

export const PROTOCOL_VERSION = 1;
export const MAX_ROWS = 5000;

/**
 * Answer a query over a shard's full entry set.
 *
 * The root is always derived from the whole shard, so proofs chain to the root
 * the signed manifest committed — never to the matching subset.
 */
export function answerQuery(shardEntries, query) {
  const root = buildRoot(shardEntries);
  const limit = Math.max(1, Math.min(Number(query.limit) || 500, MAX_ROWS));
  const matching = shardEntries.filter((entry) => matchesQuery(entry, query));
  const limited = matching.slice(0, limit);

  const entries = [];
  const proofs = [];
  for (const entry of limited) {
    const proof = createProof(shardEntries, entryKey(entry));
    if (!proof) continue;
    entries.push(entry);
    proofs.push(proof);
  }

  return {
    version: PROTOCOL_VERSION,
    shardId: query.shardId,
    answer: { root, entries, proofs },
    truncated: limited.length < matching.length,
  };
}

/** Extract a shard cell id (`geohash:u0u1`) into its pack-relative path. */
export function shardPathFor(shardId) {
  const cell = String(shardId).includes(':') ? String(shardId).split(':')[1] : String(shardId);
  return `shards/${cell}.jsonl`;
}

/** Hyperswarm topic for a shard: a 32-byte hash of its id. */
export function shardTopic(shardId) {
  return sha256(new TextEncoder().encode(`polaris/shard/${shardId}`));
}
