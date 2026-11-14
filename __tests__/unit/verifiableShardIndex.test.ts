/**
 * Verifiable shard answers (Tier 2).
 *
 * The property that matters: a peer can only ever *omit* data, never invent or
 * alter it, and omission is bounded by the signed shard's committed counts.
 */

jest.mock('expo-sqlite', () => ({}));

import {
  buildShardAnswer,
  buildShardRoot,
  canonicalShardEntry,
  createInclusionProof,
  hashLeaf,
  shardEntryKey,
  verifyAnswerCompleteness,
  verifyInclusionProof,
  verifyShardAnswer,
  type ShardEntry,
} from '../../src/services/poi/verifiableShardIndex';

function entry(overrides: Partial<ShardEntry> = {}): ShardEntry {
  return {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle',
    tags: { amenity: 'cafe', name: 'Blue Bottle' },
    ...overrides,
  };
}

function shard(count: number): ShardEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry({ osmId: i + 1, name: `POI ${i + 1}`, lat: 40 + i * 0.001 }),
  );
}

describe('canonicalisation', () => {
  it('is independent of tag key order', () => {
    const a = entry({ tags: { amenity: 'fuel', 'fuel:diesel': 'yes' } });
    const b = entry({ tags: { 'fuel:diesel': 'yes', amenity: 'fuel' } });
    expect(canonicalShardEntry(a)).toBe(canonicalShardEntry(b));
    expect(hashLeaf(a)).toBe(hashLeaf(b));
  });

  it('changes when any committed field changes', () => {
    const base = hashLeaf(entry());
    expect(hashLeaf(entry({ name: 'Other' }))).not.toBe(base);
    expect(hashLeaf(entry({ lat: 40.749 }))).not.toBe(base);
    expect(hashLeaf(entry({ osmId: 2 }))).not.toBe(base);
    expect(hashLeaf(entry({ tags: { amenity: 'cafe' } }))).not.toBe(base);
  });

  it('keys entries by OSM identity', () => {
    expect(shardEntryKey(entry({ osmType: 'way', osmId: 7 }))).toBe('way/7');
  });
});

describe('shard root', () => {
  it('is stable regardless of input order', () => {
    const entries = shard(5);
    expect(buildShardRoot([...entries].reverse())).toBe(buildShardRoot(entries));
  });

  it('is order-stable for an odd number of leaves (promotion, not duplication)', () => {
    const three = shard(3);
    expect(buildShardRoot(three)).toBe(buildShardRoot([...three].reverse()));

    // The classic duplicate-last vulnerability gives [a,b,c] and [a,b,c,c] the
    // same root. Promotion must prevent that.
    const four = shard(4);
    const withDuplicate = [...four, four[3]!];
    expect(buildShardRoot(four)).not.toBe(buildShardRoot(withDuplicate));
  });

  it('changes when a single row is added', () => {
    expect(buildShardRoot(shard(4))).not.toBe(buildShardRoot(shard(5)));
  });
});

describe('inclusion proofs', () => {
  it.each([1, 2, 3, 4, 5, 8])('round-trips for every entry of a %i-entry shard', (size) => {
    const entries = shard(size);
    const root = buildShardRoot(entries);
    for (const item of entries) {
      const proof = createInclusionProof(entries, shardEntryKey(item));
      expect(proof).not.toBeNull();
      expect(verifyInclusionProof(root, item, proof!)).toBe(true);
    }
  });

  it('returns null for an entry that is not in the shard', () => {
    const entries = shard(3);
    expect(createInclusionProof(entries, 'node/999')).toBeNull();
  });

  it('rejects a tampered entry', () => {
    const entries = shard(5);
    const root = buildShardRoot(entries);
    const target = entries[2]!;
    const proof = createInclusionProof(entries, shardEntryKey(target))!;

    const forged = { ...target, name: 'Free Pizza For Everyone' };
    expect(verifyInclusionProof(root, forged, proof)).toBe(false);
  });

  it('rejects a proof presented against the wrong root', () => {
    const entries = shard(5);
    const proof = createInclusionProof(entries, shardEntryKey(entries[0]!))!;
    const wrongRoot = buildShardRoot(shard(4));
    expect(verifyInclusionProof(wrongRoot, entries[0]!, proof)).toBe(false);
  });

  it('rejects a proof with a flipped sibling side', () => {
    const entries = shard(4);
    const root = buildShardRoot(entries);
    const target = entries[0]!;
    const proof = createInclusionProof(entries, shardEntryKey(target))!;
    if (proof.siblings.length === 0) throw new Error('expected a multi-level proof');

    const flipped = {
      ...proof,
      siblings: [{ ...proof.siblings[0]!, side: 'left' as const }, ...proof.siblings.slice(1)],
    };
    expect(verifyInclusionProof(root, target, flipped)).toBe(false);
  });
});

describe('peer answers', () => {
  it('verifies a well-formed answer', () => {
    const entries = shard(10);
    const answer = buildShardAnswer(entries, (e) => e.subtype === 'cafe');
    const result = verifyShardAnswer(answer.root, answer);

    expect(result.ok).toBe(true);
    expect(result.verified).toHaveLength(10);
    expect(result.rejected).toBe(0);
  });

  it('rejects an answer claiming a different root', () => {
    const answer = buildShardAnswer(shard(4), () => true);
    const result = verifyShardAnswer(buildShardRoot(shard(5)), answer);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('root-mismatch');
  });

  it('rejects an answer with a substituted row', () => {
    const entries = shard(6);
    const answer = buildShardAnswer(entries, () => true);
    answer.entries[0] = { ...answer.entries[0]!, name: 'Injected' };

    const result = verifyShardAnswer(answer.root, answer);
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe(1);
    expect(result.verified).toHaveLength(5);
    expect(result.reason).toBe('bad-proof');
  });

  it('rejects an answer whose proof list is shorter than its entries', () => {
    const answer = buildShardAnswer(shard(4), () => true);
    answer.proofs.pop();
    const result = verifyShardAnswer(answer.root, answer);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('proof-count');
  });

  it('detects truncation against the committed count', () => {
    const entries = shard(8);
    const answer = buildShardAnswer(entries, () => true);
    answer.entries = answer.entries.slice(0, 5);
    answer.proofs = answer.proofs.slice(0, 5);

    const verified = verifyShardAnswer(answer.root, answer);
    // Each surviving proof is valid — integrity alone cannot catch omission...
    expect(verified.ok).toBe(true);
    // ...which is why completeness is checked against the manifest's count.
    expect(verifyAnswerCompleteness(8, verified)).toBe(false);
    expect(verifyAnswerCompleteness(5, verified)).toBe(true);
  });
});
