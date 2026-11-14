/**
 * Peer shard-query protocol (Tier 2).
 *
 * The property under test: a responder can omit rows but cannot fabricate them,
 * and a client that trusts only the manifest's Merkle root rejects anything that
 * does not chain to it.
 */

jest.mock('expo-sqlite', () => ({}));

import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  ShardProtocolError,
  createQueryRateLimiter,
  createShardResponder,
  matchesShardQuery,
  normalizeShardQuery,
  requestShardAnswer,
  type ShardQuery,
} from '../../src/services/poi/shardQueryProtocol';
import { buildShardRoot, type ShardEntry } from '../../src/services/poi/verifiableShardIndex';

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

const SHARD: ShardEntry[] = [
  entry({ osmId: 1, name: 'Blue Bottle' }),
  entry({ osmId: 2, name: 'Sorbillo', subtype: 'restaurant', tags: { amenity: 'restaurant' } }),
  entry({
    osmId: 3,
    name: 'Shell',
    subtype: 'fuel',
    lat: 40.79,
    lng: -73.91,
    tags: { amenity: 'fuel', 'fuel:diesel': 'yes' },
  }),
];

const ROOT = buildShardRoot(SHARD);

function query(overrides: Partial<ShardQuery> = {}): ShardQuery {
  return {
    version: 1,
    shardId: 'geohash:dr5r',
    merkleRoot: ROOT,
    limit: 100,
    ...overrides,
  };
}

function responder() {
  return createShardResponder({ loadShard: async () => SHARD });
}

describe('query normalisation', () => {
  it('clamps the limit and defaults it when absent', () => {
    expect(normalizeShardQuery({ ...query(), limit: 10 }).limit).toBe(10);
    expect(normalizeShardQuery({ ...query(), limit: 10_000_000 }).limit).toBe(MAX_QUERY_LIMIT);
    expect(normalizeShardQuery({ ...query(), limit: -5 }).limit).toBe(1);
    const withoutLimit = query();
    delete (withoutLimit as Partial<ShardQuery>).limit;
    expect(normalizeShardQuery(withoutLimit).limit).toBe(DEFAULT_QUERY_LIMIT);
  });

  it('rejects unsupported versions, missing ids and bad roots', () => {
    expect(() => normalizeShardQuery({ ...query(), version: 2 })).toThrow(ShardProtocolError);
    expect(() => normalizeShardQuery({ ...query(), shardId: '' })).toThrow(ShardProtocolError);
    expect(() => normalizeShardQuery({ ...query(), merkleRoot: 'nope' })).toThrow(
      ShardProtocolError,
    );
    expect(() => normalizeShardQuery(null)).toThrow(ShardProtocolError);
  });

  it('drops malformed predicates instead of failing the whole query', () => {
    const normalized = normalizeShardQuery({
      ...query(),
      keys: [{ key: 'amenity' }, { value: 'ignored' }, null],
      tags: [['fuel:diesel', 'yes'], ['bad'], 'nope'],
    });
    expect(normalized.keys).toEqual([{ key: 'amenity', value: undefined }]);
    expect(normalized.tags).toEqual([['fuel:diesel', 'yes']]);
  });
});

describe('predicate matching', () => {
  it('matches any entry when no predicate is given', () => {
    expect(SHARD.every((item) => matchesShardQuery(item, query()))).toBe(true);
  });

  it('filters by primary key, optionally by value', () => {
    expect(
      SHARD.filter((item) => matchesShardQuery(item, query({ keys: [{ key: 'amenity' }] }))),
    ).toHaveLength(3);
    expect(
      SHARD.filter((item) =>
        matchesShardQuery(item, query({ keys: [{ key: 'amenity', value: 'fuel' }] })),
      ),
    ).toHaveLength(1);
  });

  it('filters by arbitrary tags', () => {
    const matches = SHARD.filter((item) =>
      matchesShardQuery(item, query({ tags: [['fuel:diesel', 'yes']] })),
    );
    expect(matches.map((item) => item.name)).toEqual(['Shell']);
  });

  it('filters by sub-box', () => {
    const matches = SHARD.filter((item) =>
      matchesShardQuery(
        item,
        query({ bounds: { south: 40.7, west: -74.0, north: 40.76, east: -73.9 } }),
      ),
    );
    expect(matches.map((item) => item.name)).toEqual(['Blue Bottle', 'Sorbillo']);
  });
});

describe('responder', () => {
  it('answers with proofs the client can verify against the manifest root', async () => {
    const respond = responder();
    const raw = await respond(query({ keys: [{ key: 'amenity', value: 'fuel' }] }));

    const result = await requestShardAnswer({ send: async () => raw }, query());

    expect(result.verification.ok).toBe(true);
    expect(result.entries.map((item) => item.name)).toEqual(['Shell']);
  });

  it('reports truncation when the limit cuts the result set', async () => {
    const respond = responder();
    const raw = await respond(query({ limit: 1 }));
    expect(raw.truncated).toBe(true);
    expect(raw.answer.entries).toHaveLength(1);

    const result = await requestShardAnswer({ send: async () => raw }, query({ limit: 1 }));
    expect(result.verification.ok).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('cannot fabricate: an edited row fails verification', async () => {
    const respond = responder();
    const raw = await respond(query());
    raw.answer.entries[0] = { ...raw.answer.entries[0]!, name: 'Injected' };

    const result = await requestShardAnswer({ send: async () => raw }, query());

    expect(result.verification.ok).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it('is caught dropping rows when the client knows the committed count', async () => {
    const respond = responder();
    const raw = await respond(query());
    raw.answer.entries.pop();
    raw.answer.proofs.pop();

    // Without a committed count the surviving rows all verify — omission is
    // invisible to integrity checks alone.
    const lenient = await requestShardAnswer({ send: async () => raw }, query());
    expect(lenient.verification.ok).toBe(true);
    expect(lenient.entries).toHaveLength(2);

    // With the count from the manifest, the short answer is rejected outright.
    const strict = await requestShardAnswer({ send: async () => raw }, query(), {
      expectedCount: 3,
    });
    expect(strict.verification.ok).toBe(false);
    expect(strict.verification.reason).toBe('incomplete');
    expect(strict.entries).toEqual([]);
  });

  it('rejects a response for a different shard', async () => {
    const respond = responder();
    const raw = await respond(query());
    await expect(
      requestShardAnswer({ send: async () => ({ ...raw, shardId: 'other' }) }, query()),
    ).rejects.toBeInstanceOf(ShardProtocolError);
  });

  it('rejects a response against a root the client trusts differently', async () => {
    const respond = responder();
    const raw = await respond(query());
    const result = await requestShardAnswer(
      { send: async () => raw },
      query({ merkleRoot: buildShardRoot([entry({ osmId: 99 })]) }),
    );
    expect(result.verification.ok).toBe(false);
    expect(result.verification.reason).toBe('root-mismatch');
  });
});

describe('rate limiter', () => {
  it('allows a burst then refills over time', () => {
    let now = 0;
    const allow = createQueryRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });

    expect(allow('peer-a')).toBe(true);
    expect(allow('peer-a')).toBe(true);
    expect(allow('peer-a')).toBe(false);

    now += 1_000;
    expect(allow('peer-a')).toBe(true);
    expect(allow('peer-b')).toBe(true);
  });
});
