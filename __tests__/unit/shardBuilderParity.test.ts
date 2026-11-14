/**
 * Pack builder <-> app verifier parity.
 *
 * `scripts/build-search-shards.mjs` computes shard SHA-256s and Merkle roots at
 * pack build time; the app verifies downloads and peer answers against them in
 * `shardManifest` / `verifiableShardIndex`. If the two implementations ever
 * disagree by a byte (field order, float precision, tag sorting, odd-node
 * promotion), every shard looks corrupt on device.
 *
 * This runs the real script on a real SQLite index and re-verifies its output
 * with the app's code.
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import { PACK_POI_SCHEMA_SQL } from '../../src/services/poi/localPoiIndex';
import { PACK_TRANSIT_SCHEMA_SQL } from '../../src/services/transit/localTransitIndex';
import {
  buildShardRoot,
  canonicalShardEntry,
  hashLeaf,
  type ShardEntry,
} from '../../src/services/poi/verifiableShardIndex';
import {
  verifyShardBytes,
  shardForPoint,
  verifyShardManifest,
  type ShardDescriptor,
} from '../../src/services/regions/shardManifest';

const SCRIPT = resolve(__dirname, '../../scripts/build-search-shards.mjs');

const POIS: ShardEntry[] = [
  {
    osmType: 'node',
    osmId: 101,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle',
    tags: { amenity: 'cafe', name: 'Blue Bottle', 'addr:street': 'Bleecker St' },
  },
  {
    osmType: 'way',
    osmId: 202,
    lat: 40.7485,
    lng: -73.9855,
    primaryKey: 'shop',
    subtype: 'bakery',
    name: 'Dominique Ansel Bakery',
    tags: { shop: 'bakery', name: 'Dominique Ansel Bakery' },
  },
  {
    osmType: 'node',
    osmId: 303,
    lat: 40.7489,
    lng: -73.9862,
    primaryKey: 'amenity',
    subtype: 'restaurant',
    name: 'Pizzeria Sorbillo',
    tags: { amenity: 'restaurant', name: 'Pizzeria Sorbillo', cuisine: 'pizza' },
  },
  {
    // A different geohash cell, so the script has to split.
    osmType: 'node',
    osmId: 404,
    lat: 51.5,
    lng: -0.12,
    primaryKey: 'amenity',
    subtype: 'fuel',
    name: 'Shell',
    tags: { amenity: 'fuel', name: 'Shell', 'fuel:diesel': 'yes' },
  },
  {
    osmType: 'node',
    osmId: 505,
    lat: 40.7492,
    lng: -73.9848,
    primaryKey: 'amenity',
    subtype: 'pharmacy',
    name: 'Duane Reade',
    tags: { amenity: 'pharmacy', name: 'Duane Reade' },
  },
];

function buildIndex(dir: string): string {
  const dbPath = join(dir, 'search.sqlite');
  rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  db.exec(PACK_POI_SCHEMA_SQL);
  const insert = db.prepare(
    `INSERT INTO osm_pois
       (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm,
        tags_json, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  for (const poi of POIS) {
    insert.run(
      poi.osmType,
      poi.osmId,
      poi.lat,
      poi.lng,
      poi.primaryKey,
      poi.subtype,
      poi.name,
      poi.name.toLowerCase(),
      JSON.stringify(poi.tags),
    );
  }
  db.close();
  return dbPath;
}

describe('pack builder / app verifier parity', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'polaris-shards-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('produces shard bytes and Merkle roots the app verifies', () => {
    const dbPath = buildIndex(dir);
    execFileSync(process.execPath, [SCRIPT, dbPath, dir], { stdio: 'pipe' });

    const manifest = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8')) as {
      shards: ShardDescriptor[];
    };

    expect(manifest.shards.length).toBeGreaterThan(0);

    for (const descriptor of manifest.shards) {
      const payload = readFileSync(join(dir, descriptor.path));

      // 1. Byte-level commitment: the app's verifier accepts the builder's hash.
      expect(verifyShardBytes(new Uint8Array(payload), descriptor)).toBe(true);

      // 2. Merkle commitment: the app rebuilds the same root from the payload.
      const entries = payload
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ShardEntry);

      expect(entries).toHaveLength(descriptor.poiCount);
      expect(buildShardRoot(entries)).toBe(descriptor.merkleRoot);

      // 3. Spot-check a single leaf, which is what inclusion proofs chain from.
      for (const entry of entries) {
        expect(hashLeaf(entry)).toHaveLength(64);
        expect(canonicalShardEntry(entry)).toContain(entry.name);
      }
    }
  });

  it('covers every input POI exactly once, in cells that contain them', () => {
    const dbPath = buildIndex(dir);
    execFileSync(process.execPath, [SCRIPT, dbPath, dir], { stdio: 'pipe' });

    const manifest = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8')) as {
      shards: ShardDescriptor[];
    };

    const total = manifest.shards.reduce((sum, shard) => sum + shard.poiCount, 0);
    expect(total).toBe(POIS.length);

    for (const poi of POIS) {
      const shard = shardForPoint(manifest.shards, poi.lat, poi.lng);
      expect(shard).not.toBeNull();
      expect(poi.lat).toBeGreaterThanOrEqual(shard!.south);
      expect(poi.lat).toBeLessThanOrEqual(shard!.north);
    }

    // London and New York must not share a cell.
    const nyc = shardForPoint(manifest.shards, 40.748, -73.985)!;
    const london = shardForPoint(manifest.shards, 51.5, -0.12)!;
    expect(nyc.shardId).not.toBe(london.shardId);
  });
});

describe('pack schemas', () => {
  it('transit pack schema creates the tables the importer copies from', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PACK_TRANSIT_SCHEMA_SQL);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(['osm_transit_route_stops', 'osm_transit_routes', 'osm_transit_stops']);
    db.close();
  });

  it('exposes a manifest verification path for builder output', () => {
    // Signed manifests are produced by the publisher step; this asserts the
    // verifier exists as the single trust entry point for shard descriptors.
    expect(typeof verifyShardManifest).toBe('function');
  });
});
