/**
 * End-to-end: pack build → shards → import → query.
 *
 * Runs the *real* importer and query code (ATTACH-based pack import, FTS/tag
 * query, transit join) against real SQLite through an async adapter, and the
 * *real* shard builder script. What this proves is the thing unit tests can
 * miss: that a pack produced by the builder is queryable by the app.
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

jest.mock('expo-sqlite', () => ({
  // The row-wise fallback opens the pack with a second connection.
  openDatabaseAsync: async (path: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync: SqliteDb } = require('node:sqlite') as typeof import('node:sqlite');
    return mockAdapt(new SqliteDb(path));
  },
}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockHolder: { db: DatabaseSync | null; failAttach: boolean } = {
  db: null,
  failAttach: false,
};

function mockAdapt(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      if (mockHolder.failAttach && /^\s*ATTACH/i.test(sql)) {
        throw new Error('ATTACH not permitted in this test');
      }
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

jest.mock('../../src/services/database/init', () => ({
  getDatabase: async () => {
    if (!mockHolder.db) throw new Error('test database not initialised');
    return mockAdapt(mockHolder.db);
  },
}));

import {
  PACK_POI_SCHEMA_SQL,
  LOCAL_POI_SCHEMA_SQL,
  hasLocalPoiCoverage,
  importLocalPoiIndexFromPack,
  queryLocalPois,
} from '../../src/services/poi/localPoiIndex';
import {
  PACK_TRANSIT_SCHEMA_SQL,
  LOCAL_TRANSIT_SCHEMA_SQL,
  importLocalTransitIndexFromPack,
  localRoutesAtPoint,
  queryRouteTagsAtStops,
  queryTransitRoutesInBounds,
  queryTransitStopsNear,
} from '../../src/services/transit/localTransitIndex';
import { parseShardPayload, verifyShardPayload } from '../../src/services/poi/shardedPoiSource';
import { buildShardRoot } from '../../src/services/poi/verifiableShardIndex';
import { verifyShardBytes, type ShardDescriptor } from '../../src/services/regions/shardManifest';

const SCRIPT = resolve(__dirname, '../../scripts/build-search-shards.mjs');
const BOUNDS = { minLat: 40.7, maxLat: 40.8, minLng: -74.02, maxLng: -73.95 };
const GEO = {
  south: BOUNDS.minLat,
  north: BOUNDS.maxLat,
  west: BOUNDS.minLng,
  east: BOUNDS.maxLng,
};

interface PackPoi {
  osmType: 'node' | 'way';
  osmId: number;
  lat: number;
  lng: number;
  primaryKey: string;
  subtype: string;
  name: string;
  tags: Record<string, string>;
}

const PACK_POIS: PackPoi[] = [
  {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle Coffee',
    tags: { amenity: 'cafe', name: 'Blue Bottle Coffee' },
  },
  {
    osmType: 'way',
    osmId: 2,
    lat: 40.749,
    lng: -73.986,
    primaryKey: 'shop',
    subtype: 'bakery',
    name: 'Dominique Ansel Bakery',
    tags: { shop: 'bakery', name: 'Dominique Ansel Bakery' },
  },
  {
    osmType: 'node',
    osmId: 3,
    lat: 40.75,
    lng: -73.98,
    primaryKey: 'amenity',
    subtype: 'fuel',
    name: 'Shell',
    tags: { amenity: 'fuel', name: 'Shell', 'fuel:diesel': 'yes' },
  },
];

function writePack(dir: string): { poiPath: string; transitPath: string } {
  const poiPath = join(dir, 'search.sqlite');
  const transitPath = join(dir, 'transit.sqlite');
  rmSync(poiPath, { force: true });
  rmSync(transitPath, { force: true });

  const poiDb = new DatabaseSync(poiPath);
  poiDb.exec(PACK_POI_SCHEMA_SQL);
  const insertPoi = poiDb.prepare(
    `INSERT INTO osm_pois
       (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm,
        tags_json, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  for (const poi of PACK_POIS) {
    insertPoi.run(
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
  poiDb.close();

  const transitDb = new DatabaseSync(transitPath);
  transitDb.exec(PACK_TRANSIT_SCHEMA_SQL);
  transitDb.exec(`
    INSERT INTO osm_transit_stops (osm_id, name, lat, lng, tags_json, updated_at)
    VALUES (100, 'Bleecker St', 40.7255, -73.9947, '{"railway":"station"}', 1),
           (101, 'Astor Pl', 40.7300, -73.9910, '{"railway":"station"}', 1);

    INSERT INTO osm_transit_routes
      (osm_id, mode, ref, name, colour, geometry_json, stop_ids_json,
       south, west, north, east, updated_at)
    VALUES (9, 'SUBWAY', '6', 'Lexington Av Local', '00933C',
            '[[40.7255,-73.9947],[40.73,-73.991]]', '[100,101]',
            40.7255, -73.9947, 40.73, -73.991, 1);

    INSERT INTO osm_transit_route_stops (stop_osm_id, route_osm_id) VALUES (100, 9), (101, 9);
  `);
  transitDb.close();

  return { poiPath, transitPath };
}

describe('pack → shards → index → query', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'polaris-pipeline-'));
    mockHolder.db = new DatabaseSync(':memory:');
    mockHolder.db.exec(LOCAL_POI_SCHEMA_SQL);
    mockHolder.db.exec(LOCAL_TRANSIT_SCHEMA_SQL);
  });

  afterAll(() => {
    mockHolder.db?.close();
    mockHolder.db = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('imports the pack so POI queries answer locally', async () => {
    const { poiPath } = writePack(dir);

    const imported = await importLocalPoiIndexFromPack(poiPath, 'us-ny-new-york', GEO);
    expect(imported).toBe(PACK_POIS.length);

    expect(await hasLocalPoiCoverage(GEO)).toBe(true);

    const cafes = await queryLocalPois({ ...GEO, keys: [{ key: 'amenity', value: 'cafe' }] });
    expect(cafes.map((poi) => poi.name)).toEqual(['Blue Bottle Coffee']);

    const diesel = await queryLocalPois({ ...GEO, tags: [['fuel:diesel', 'yes']] });
    expect(diesel.map((poi) => poi.name)).toEqual(['Shell']);

    const byName = await queryLocalPois({ ...GEO, namePattern: 'bakery' });
    expect(byName.map((poi) => poi.name)).toEqual(['Dominique Ansel Bakery']);
  });

  it('re-importing the same pack replaces rows instead of duplicating them', async () => {
    const { poiPath } = writePack(dir);
    await importLocalPoiIndexFromPack(poiPath, 'us-ny-new-york', GEO);

    const count = mockHolder.db!.prepare('SELECT COUNT(*) AS n FROM osm_pois').get() as {
      n: number;
    };
    expect(count.n).toBe(PACK_POIS.length);
  });

  it('imports transit and answers the stop-card query locally', async () => {
    const { transitPath } = writePack(dir);

    await importLocalTransitIndexFromPack(transitPath, 'us-ny-new-york', GEO);

    const stops = await queryTransitStopsNear(40.7255, -73.9947, 100);
    expect(stops.map((stop) => stop.name)).toContain('Bleecker St');

    const routes = await queryRouteTagsAtStops([100]);
    expect(routes).toEqual([
      { ref: '6', name: 'Lexington Av Local', colour: '00933C', mode: 'SUBWAY' },
    ]);

    const viaPoint = await localRoutesAtPoint(40.7255, -73.9947);
    expect(viaPoint?.map((route) => route.ref)).toEqual(['6']);

    const viewport = await queryTransitRoutesInBounds({
      south: 40.7,
      west: -74.02,
      north: 40.8,
      east: -73.95,
    });
    expect(viewport.map((route) => route.osmId)).toEqual([9]);
    expect(viewport[0]!.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it('produces shards whose bytes and roots verify against the app code', () => {
    const { poiPath } = writePack(dir);
    const outDir = join(dir, 'shards-out');
    mkdirSync(outDir, { recursive: true });

    execFileSync(process.execPath, [SCRIPT, poiPath, outDir], { stdio: 'pipe' });

    const { shards } = JSON.parse(readFileSync(join(outDir, 'shards.json'), 'utf8')) as {
      shards: ShardDescriptor[];
    };

    const covered: string[] = [];
    for (const descriptor of shards) {
      const bytes = new Uint8Array(readFileSync(join(outDir, descriptor.path)));
      expect(verifyShardBytes(bytes, descriptor)).toBe(true);
      expect(verifyShardPayload(descriptor, bytes)).toBe(true);
      covered.push(...parseShardPayload(bytes).map((entry) => entry.name));
    }

    expect(covered.sort()).toEqual(PACK_POIS.map((poi) => poi.name).sort());
  });

  it('falls back to row-wise import when ATTACH is refused, with identical rows', async () => {
    const { poiPath } = writePack(dir);

    // Reset the local index so the assertion can only pass via the fallback.
    mockHolder.db!.exec('DELETE FROM osm_pois');
    mockHolder.failAttach = true;
    try {
      const imported = await importLocalPoiIndexFromPack(poiPath, 'fallback-region', GEO);
      expect(imported).toBe(PACK_POIS.length);
    } finally {
      mockHolder.failAttach = false;
    }

    const cafes = await queryLocalPois({ ...GEO, keys: [{ key: 'amenity', value: 'cafe' }] });
    expect(cafes.map((poi) => poi.name)).toEqual(['Blue Bottle Coffee']);

    const names = mockHolder
      .db!.prepare('SELECT name FROM osm_pois ORDER BY osm_id')
      .all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual(PACK_POIS.map((poi) => poi.name));
  });

  it('a shard root is reproducible from its payload alone', () => {
    const { poiPath } = writePack(dir);
    const outDir = join(dir, 'shards-root');
    mkdirSync(outDir, { recursive: true });
    execFileSync(process.execPath, [SCRIPT, poiPath, outDir], { stdio: 'pipe' });

    const { shards } = JSON.parse(readFileSync(join(outDir, 'shards.json'), 'utf8')) as {
      shards: ShardDescriptor[];
    };

    for (const descriptor of shards) {
      const entries = parseShardPayload(
        new Uint8Array(readFileSync(join(outDir, descriptor.path))),
      );
      expect(buildShardRoot(entries)).toBe(descriptor.merkleRoot);
    }
  });
});
