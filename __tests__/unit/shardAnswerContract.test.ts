/**
 * Worklet responder ↔ app verifier contract.
 *
 * `backend/shard-answer.mjs` builds the answers peers return from the Bare
 * worklet; `verifiableShardIndex` verifies them on device. They are two
 * implementations of the same Merkle scheme in two runtimes, so a one-byte
 * disagreement (field order, float precision, tag sorting, odd-node promotion,
 * proof layout) would make every peer answer fail verification — silently, as a
 * "peer sent garbage" log line.
 *
 * This runs the worklet module under Node and checks it against the app code.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  buildShardAnswer,
  buildShardRoot,
  canonicalShardEntry,
  hashLeaf,
  verifyShardAnswer,
  type ShardEntry,
} from '../../src/services/poi/verifiableShardIndex';
import { requestShardAnswer } from '../../src/services/poi/shardQueryProtocol';
import { shardTopicFor } from '../../src/services/poi/hyperswarmShardClient';

const SCRIPT = resolve(__dirname, '../../scripts/verify-shard-answer.mjs');

const SHARD: ShardEntry[] = [
  {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle',
    tags: { amenity: 'cafe', name: 'Blue Bottle', 'addr:street': 'Bleecker St' },
  },
  {
    osmType: 'node',
    osmId: 2,
    lat: 40.749,
    lng: -73.986,
    primaryKey: 'amenity',
    subtype: 'restaurant',
    name: 'Sorbillo',
    tags: { amenity: 'restaurant', name: 'Sorbillo' },
  },
  {
    osmType: 'way',
    osmId: 3,
    lat: 40.79,
    lng: -73.91,
    primaryKey: 'amenity',
    subtype: 'fuel',
    name: 'Shell',
    tags: { amenity: 'fuel', name: 'Shell', 'fuel:diesel': 'yes' },
  },
];

interface WorkletOutput {
  root: string;
  canonical: string;
  leaf: string;
  shardPath: string;
  shardTopic: string;
  matches: { any: number; fuel: number; diesel: number };
  full: {
    version: number;
    shardId: string;
    answer: { root: string; entries: ShardEntry[]; proofs: unknown[] };
    truncated: boolean;
  };
  filtered: typeof SHARD extends never
    ? never
    : { answer: { entries: ShardEntry[] }; truncated: boolean };
  truncated: { answer: { entries: ShardEntry[] }; truncated: boolean };
}

function runWorklet(): WorkletOutput {
  const raw = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  return JSON.parse(raw) as WorkletOutput;
}

describe('worklet responder contract', () => {
  const worklet = runWorklet();

  it('computes the same Merkle root as the app', () => {
    expect(worklet.root).toBe(buildShardRoot(SHARD));
  });

  it('serialises entries identically', () => {
    expect(worklet.canonical).toBe(canonicalShardEntry(SHARD[0]!));
    expect(worklet.leaf).toBe(hashLeaf(SHARD[0]!));
  });

  it('derives the same shard path and swarm topic', () => {
    expect(worklet.shardPath).toBe('shards/u0u1.jsonl');
    expect(worklet.shardTopic).toBe(
      Array.from(shardTopicFor('geohash:u0u1'))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    );
  });

  it('parses a JSONL payload back to the same entries', () => {
    expect(worklet.jsonlRoundTrip).toEqual(SHARD);
  });

  it('matches the same rows for the same predicates', () => {
    const any = SHARD.length;
    const fuel = SHARD.filter((entry) => entry.subtype === 'fuel').length;
    const diesel = SHARD.filter((entry) => entry.tags['fuel:diesel'] === 'yes').length;
    expect(worklet.matches).toEqual({ any, fuel, diesel });
  });

  it('produces an answer the app verifier accepts', async () => {
    const verification = verifyShardAnswer(buildShardRoot(SHARD), worklet.full.answer as never);
    expect(verification.ok).toBe(true);
    expect(verification.verified).toHaveLength(SHARD.length);

    const viaClient = await requestShardAnswer(
      { send: async () => worklet.full },
      {
        version: 1,
        shardId: 'geohash:u0u1',
        merkleRoot: buildShardRoot(SHARD),
        limit: 100,
      },
      { expectedCount: SHARD.length },
    );
    expect(viaClient.verification.ok).toBe(true);
    expect(viaClient.entries.map((entry) => entry.name).sort()).toEqual([
      'Blue Bottle',
      'Shell',
      'Sorbillo',
    ]);
  });

  it('answers a filtered query with only matching rows, still verified', async () => {
    const result = await requestShardAnswer(
      { send: async () => worklet.filtered },
      {
        version: 1,
        shardId: 'geohash:u0u1',
        merkleRoot: buildShardRoot(SHARD),
        keys: [{ key: 'amenity', value: 'fuel' }],
        limit: 100,
      },
    );

    expect(result.verification.ok).toBe(true);
    expect(result.entries.map((entry) => entry.name)).toEqual(['Shell']);
    expect(result.truncated).toBe(false);
  });

  it('flags truncation identically to the app responder', async () => {
    const appAnswer = buildShardAnswer(SHARD, () => true);

    expect(worklet.truncated.answer.entries).toHaveLength(1);
    expect(worklet.truncated.truncated).toBe(true);
    expect(appAnswer.entries).toHaveLength(SHARD.length);
  });

  it('builds the same proof for a given row as the app', () => {
    const workletProof = worklet.full.answer.proofs[0] as {
      leaf: string;
      index: number;
      total: number;
      siblings: Array<{ hash: string | null; side: string }>;
    };
    const appAnswer = buildShardAnswer(
      SHARD,
      (entry) => entry.name === worklet.full.answer.entries[0]!.name,
    );
    const appProof = appAnswer.proofs[0]!;

    expect(workletProof.leaf).toBe(appProof.leaf);
    expect(workletProof.index).toBe(appProof.index);
    expect(workletProof.total).toBe(appProof.total);
    expect(workletProof.siblings).toEqual(appProof.siblings);
  });
});
