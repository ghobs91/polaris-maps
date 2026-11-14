/**
 * Peer POI queries (tier 2 fallback).
 *
 * The behaviour that matters: peer rows are used for the current query only, are
 * deduplicated across shards, and are never recorded as coverage — a filtered
 * answer says nothing about the rest of the cell.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockQueryPeersForEntries = jest.fn();
jest.mock('../../src/services/poi/hyperswarmShardClient', () => ({
  queryPeersForEntries: (...args: unknown[]) => mockQueryPeersForEntries(...args),
  shardTopicFor: jest.fn(),
}));

const mockConfiguredSources: {
  shardSets: Array<
    Array<{
      shardId: string;
      merkleRoot: string;
      south: number;
      west: number;
      north: number;
      east: number;
    }>
  >;
} = { shardSets: [] };

jest.mock('../../src/services/poi/shardedPoiSource', () => ({
  getShardSources: () => ({ ...mockConfiguredSources, sources: [] }),
}));

import { peerQueryCandidates, queryPeersForPois } from '../../src/services/poi/peerPoiQuery';
import type { ShardEntry } from '../../src/services/poi/verifiableShardIndex';

const NYC = { south: 40.7, west: -74.0, north: 40.8, east: -73.9 };

function entry(overrides: Partial<ShardEntry>): ShardEntry {
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

const NYC_SHARD = {
  shardId: 'geohash:dr5r',
  merkleRoot: 'a'.repeat(64),
  south: 40.7,
  west: -74.0,
  north: 40.8,
  east: -73.9,
};

beforeEach(() => {
  mockQueryPeersForEntries.mockReset();
  mockConfiguredSources.shardSets = [[NYC_SHARD]];
});

describe('peerQueryCandidates', () => {
  it('returns shards intersecting the box', () => {
    expect(peerQueryCandidates(NYC).map((shard) => shard.shardId)).toEqual(['geohash:dr5r']);
  });

  it('returns nothing when the box intersects no registered shard', () => {
    const london = { south: 51.45, west: -0.2, north: 51.55, east: -0.05 };
    expect(peerQueryCandidates(london)).toEqual([]);
  });

  it('returns nothing when no pack is registered', () => {
    mockConfiguredSources.shardSets = [];
    expect(peerQueryCandidates(NYC)).toEqual([]);
  });
});

describe('queryPeersForPois', () => {
  it('asks each candidate with the intersection of the query box and the shard', async () => {
    mockQueryPeersForEntries.mockResolvedValue([]);

    await queryPeersForPois({ ...NYC, limit: 25 });

    expect(mockQueryPeersForEntries).toHaveBeenCalledTimes(1);
    const [shardId, merkleRoot, predicate, opts] = mockQueryPeersForEntries.mock.calls[0]!;
    expect(shardId).toBe('geohash:dr5r');
    expect(merkleRoot).toBe('a'.repeat(64));
    expect(predicate.bounds).toEqual(NYC);
    expect(opts.limit).toBe(25);
  });

  it('maps verified entries onto the POI shape', async () => {
    mockQueryPeersForEntries.mockResolvedValue([entry({})]);

    const pois = await queryPeersForPois(NYC);

    expect(pois).toEqual([
      {
        id: 1,
        lat: 40.748,
        lng: -73.985,
        name: 'Blue Bottle',
        type: 'amenity',
        subtype: 'cafe',
        tags: { amenity: 'cafe', name: 'Blue Bottle' },
      },
    ]);
  });

  it('deduplicates rows returned by more than one shard', async () => {
    mockConfiguredSources.shardSets = [[NYC_SHARD, { ...NYC_SHARD, shardId: 'geohash:dr5s' }]];
    mockQueryPeersForEntries.mockResolvedValue([entry({})]);

    const pois = await queryPeersForPois(NYC);
    expect(pois).toHaveLength(1);
  });

  it('returns empty when peers answer nothing (caller falls through to Overpass)', async () => {
    mockQueryPeersForEntries.mockResolvedValue([]);
    expect(await queryPeersForPois(NYC)).toEqual([]);
  });

  it('swallows a shard failure and still returns the other shards', async () => {
    mockConfiguredSources.shardSets = [[NYC_SHARD, { ...NYC_SHARD, shardId: 'geohash:dr5s' }]];
    mockQueryPeersForEntries
      .mockRejectedValueOnce(new Error('no peers'))
      .mockResolvedValueOnce([entry({ osmId: 2, name: 'Sorbillo' })]);

    const pois = await queryPeersForPois(NYC);
    expect(pois.map((poi) => poi.name)).toEqual(['Sorbillo']);
  });

  it('does not touch the local index or coverage', () => {
    // The module imports neither upsertLocalPois nor recordLocalPoiCoverage;
    // this guards against a future change quietly marking cells covered from a
    // filtered answer.
    const source = readFileSync(join(__dirname, '../../src/services/poi/peerPoiQuery.ts'), 'utf8');
    expect(source).not.toContain('upsertLocalPois');
    expect(source).not.toContain('recordLocalPoiCoverage');
  });
});
