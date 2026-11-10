/**
 * Shard-fetching POI source (Tier 1 consumer).
 *
 * Runs the real consumer against a real SQLite database through an async
 * adapter (same tables/schema as the device), with shard bytes served from a
 * fake peer. This covers the path that matters: viewport → descriptor → verify →
 * import → "the next query is local".
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockHolder: { db: DatabaseSync | null } = { db: null };

jest.mock('../../src/services/database/init', () => ({
  getDatabase: async () => {
    if (!mockHolder.db) throw new Error('test database not initialised');
    return mockAdapt(mockHolder.db);
  },
}));

/** Minimal expo-sqlite-shaped async adapter over node:sqlite. */
function mockAdapt(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    getAllAsync: async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(...(params as never[])) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    closeAsync: async () => {},
  };
}

import { LOCAL_POI_SCHEMA_SQL, buildPoiCoverageQuery } from '../../src/services/poi/localPoiIndex';
import {
  SHARD_CACHE_SCHEMA_SQL,
  __resetShardSourcesForTests,
  buildShardCacheLookup,
  configureShardSources,
  ensureShardCoverage,
  hasShardCoverage,
  parseShardPayload,
  shardDescriptorsForPoint,
  shardEntryToPoi,
  verifyShardPayload,
} from '../../src/services/poi/shardedPoiSource';
import { buildShardRoot, type ShardEntry } from '../../src/services/poi/verifiableShardIndex';
import { sha256Hex, type ShardDescriptor } from '../../src/services/regions/shardManifest';

const NYC = { south: 40.7, west: -74.0, north: 40.8, east: -73.9 };
const LONDON = { south: 51.45, west: -0.2, north: 51.55, east: -0.05 };

function entry(overrides: Partial<ShardEntry>): ShardEntry {
  return {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Cafe',
    tags: { amenity: 'cafe', name: 'Cafe' },
    ...overrides,
  };
}

const NYC_ENTRIES = [
  entry({ osmId: 1, name: 'Blue Bottle' }),
  entry({ osmId: 2, name: 'Pizzeria Sorbillo', primaryKey: 'amenity', subtype: 'restaurant' }),
];

const LONDON_ENTRIES = [entry({ osmId: 3, lat: 51.5, lng: -0.12, name: 'Shell', subtype: 'fuel' })];

function makeDescriptor(
  bytes: Uint8Array,
  entries: ShardEntry[],
  bounds: typeof NYC,
  shardId: string,
): ShardDescriptor {
  return {
    shardId,
    path: `shards/${shardId}.jsonl`,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    merkleRoot: buildShardRoot(entries),
    ...bounds,
    poiCount: entries.length,
  };
}

function payload(entries: ShardEntry[]): Uint8Array {
  return new TextEncoder().encode(entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('shard payload helpers', () => {
  it('parses JSONL payloads, ignoring blank lines', () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(NYC_ENTRIES[0])}\n\n\n`);
    expect(parseShardPayload(bytes)).toHaveLength(1);
    expect(parseShardPayload(bytes)[0]!.name).toBe('Blue Bottle');
  });

  it('maps a committed entry onto the local index POI shape', () => {
    const poi = shardEntryToPoi(NYC_ENTRIES[0]!);
    expect(poi).toMatchObject({
      id: 1,
      name: 'Blue Bottle',
      type: 'amenity',
      subtype: 'cafe',
      osmType: 'node',
    });
  });

  it('accepts a payload matching the descriptor', () => {
    const bytes = payload(NYC_ENTRIES);
    expect(verifyShardPayload(makeDescriptor(bytes, NYC_ENTRIES, NYC, 'nyc'), bytes)).toBe(true);
  });

  it('rejects a payload with a dropped entry', () => {
    const bytes = payload(NYC_ENTRIES);
    const descriptor = makeDescriptor(bytes, NYC_ENTRIES, NYC, 'nyc');
    const truncated = payload([NYC_ENTRIES[0]!]);
    expect(verifyShardPayload(descriptor, truncated)).toBe(false);
  });

  it('rejects a payload whose entries changed', () => {
    const bytes = payload(NYC_ENTRIES);
    const descriptor = makeDescriptor(bytes, NYC_ENTRIES, NYC, 'nyc');
    const tampered = payload([{ ...NYC_ENTRIES[0]!, name: 'Injected' }, NYC_ENTRIES[1]!]);
    expect(verifyShardPayload(descriptor, tampered)).toBe(false);
  });
});

describe('ensureShardCoverage', () => {
  let nycBytes: Uint8Array;
  let nycDescriptor: ShardDescriptor;
  let londonDescriptor: ShardDescriptor;
  let peerReads: string[];

  beforeEach(() => {
    mockHolder.db = new DatabaseSync(':memory:');
    mockHolder.db.exec(LOCAL_POI_SCHEMA_SQL);
    mockHolder.db.exec(SHARD_CACHE_SCHEMA_SQL);
    __resetShardSourcesForTests();

    nycBytes = payload(NYC_ENTRIES);
    nycDescriptor = makeDescriptor(nycBytes, NYC_ENTRIES, NYC, 'nyc');
    londonDescriptor = makeDescriptor(payload(LONDON_ENTRIES), LONDON_ENTRIES, LONDON, 'london');

    peerReads = [];
    configureShardSources({
      shardSets: [[nycDescriptor, londonDescriptor]],
      sources: [
        {
          kind: 'peer',
          label: 'test-peer',
          read: async () => {
            if (peerReads.length === 0) {
              peerReads.push('nyc');
              return nycBytes;
            }
            peerReads.push('london');
            return payload(LONDON_ENTRIES);
          },
        },
      ],
    });
  });

  afterEach(() => {
    mockHolder.db?.close();
    mockHolder.db = null;
  });

  it('imports matching shards and marks the box covered', async () => {
    expect(await hasShardCoverage(NYC)).toBe(false);

    const result = await ensureShardCoverage(NYC);

    expect(result).toEqual({ shardsFetched: 1, shardsCached: 0, entries: 2, failures: 0 });
    expect(await hasShardCoverage(NYC)).toBe(true);

    const pois = mockHolder
      .db!.prepare('SELECT name FROM osm_pois ORDER BY osm_id')
      .all() as Array<{ name: string }>;
    expect(pois.map((row) => row.name)).toEqual(['Blue Bottle', 'Pizzeria Sorbillo']);
  });

  it('records coverage so the tier-0 query path answers next time', async () => {
    await ensureShardCoverage(NYC);

    const { sql, params } = buildPoiCoverageQuery(NYC);
    const row = mockHolder.db!.prepare(sql).get(...(params as never[])) as { covered: number };
    expect(row.covered).toBeGreaterThan(0);
  });

  it('does not refetch a shard that is already imported', async () => {
    await ensureShardCoverage(NYC);
    const readsAfterFirst = peerReads.length;

    const second = await ensureShardCoverage(NYC);

    expect(peerReads.length).toBe(readsAfterFirst);
    expect(second).toEqual({ shardsFetched: 0, shardsCached: 1, entries: 0, failures: 0 });
  });

  it('refetches when the descriptor version changes', async () => {
    await ensureShardCoverage(NYC);

    // A republished shard has a new hash for the same id.
    const updatedEntries = [entry({ osmId: 1, name: 'Blue Bottle (new)' })];
    const updatedBytes = payload(updatedEntries);
    const updated = makeDescriptor(updatedBytes, updatedEntries, NYC, 'nyc');
    configureShardSources({
      shardSets: [[updated]],
      sources: [{ kind: 'peer', label: 'test-peer', read: async () => updatedBytes }],
    });

    expect(await hasShardCoverage(NYC)).toBe(false);
    const result = await ensureShardCoverage(NYC);
    expect(result.shardsFetched).toBe(1);

    const names = mockHolder
      .db!.prepare('SELECT name FROM osm_pois ORDER BY osm_id')
      .all() as Array<{ name: string }>;
    expect(names[0]!.name).toBe('Blue Bottle (new)');
  });

  it('rejects a peer that serves tampered bytes, and stays uncovered', async () => {
    configureShardSources({
      shardSets: [[nycDescriptor]],
      sources: [
        {
          kind: 'peer',
          label: 'liar',
          // Same length, different content: only the hash can catch this.
          read: async () => {
            const copy = new Uint8Array(nycBytes);
            copy[copy.length - 2] = 0x20;
            return copy;
          },
        },
      ],
    });

    const result = await ensureShardCoverage(NYC);

    expect(result.shardsFetched).toBe(0);
    expect(result.failures).toBe(1);
    expect(await hasShardCoverage(NYC)).toBe(false);
    const count = mockHolder.db!.prepare('SELECT COUNT(*) AS n FROM osm_pois').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('is a no-op when nothing is registered', async () => {
    __resetShardSourcesForTests();
    expect(await ensureShardCoverage(NYC)).toEqual({
      shardsFetched: 0,
      shardsCached: 0,
      entries: 0,
      failures: 0,
    });
    expect(await hasShardCoverage(NYC)).toBe(false);
  });

  it('does not cover a box no shard intersects', async () => {
    const elsewhere = { south: -33.9, west: 18.3, north: -33.8, east: 18.5 };
    const result = await ensureShardCoverage(elsewhere);
    expect(result.shardsFetched).toBe(0);
    expect(await hasShardCoverage(elsewhere)).toBe(false);
  });
});

describe('descriptor helpers', () => {
  it('finds the shard covering a point across sets', () => {
    const descriptor = makeDescriptor(payload(NYC_ENTRIES), NYC_ENTRIES, NYC, 'nyc');
    expect(shardDescriptorsForPoint([[descriptor]], 40.75, -73.95)).toHaveLength(1);
    expect(shardDescriptorsForPoint([[descriptor]], 51.5, -0.12)).toHaveLength(0);
  });

  it('builds a parameterised cache lookup', () => {
    const { sql, params } = buildShardCacheLookup(['a', 'b']);
    expect(sql).toContain('IN (?, ?)');
    expect(params).toEqual(['a', 'b']);
  });

  it('returns an empty lookup for no ids', () => {
    const { sql, params } = buildShardCacheLookup([]);
    expect(sql).toContain('WHERE 0');
    expect(params).toEqual([]);
  });
});
