/**
 * On-device POI index (the Tier 0 Overpass replacement).
 *
 * Runs the real schema and the real generated SQL against Node's bundled
 * SQLite (`node:sqlite`), which has the same FTS5/JSON1 support as the
 * expo-sqlite build — so the parts that actually decide which POIs come back
 * are exercised without a device.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import {
  LOCAL_POI_SCHEMA_SQL,
  PACK_POI_SCHEMA_SQL,
  buildLocalPoiQuery,
  buildPoiCoverageQuery,
  ftsQueryFromText,
} from '../../src/services/poi/localPoiIndex';

interface Fixture {
  osmType: 'node' | 'way';
  osmId: number;
  lat: number;
  lng: number;
  primaryKey: string;
  subtype: string;
  name: string;
  tags: Record<string, string>;
}

const FIXTURES: Fixture[] = [
  {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle Coffee',
    tags: { amenity: 'cafe', name: 'Blue Bottle Coffee', cuisine: 'coffee_shop' },
  },
  {
    osmType: 'node',
    osmId: 2,
    lat: 40.749,
    lng: -73.986,
    primaryKey: 'amenity',
    subtype: 'restaurant',
    name: 'Pizzeria Sorbillo',
    tags: { amenity: 'restaurant', name: 'Pizzeria Sorbillo', 'addr:street': 'Bleecker St' },
  },
  {
    osmType: 'way',
    osmId: 3,
    lat: 40.7485,
    lng: -73.9855,
    primaryKey: 'shop',
    subtype: 'bakery',
    name: 'Dominique Ansel Bakery',
    tags: { shop: 'bakery', name: 'Dominique Ansel Bakery' },
  },
  {
    osmType: 'node',
    osmId: 4,
    lat: 51.5,
    lng: -0.12,
    primaryKey: 'amenity',
    subtype: 'fuel',
    name: 'Shell',
    tags: { amenity: 'fuel', name: 'Shell', 'fuel:diesel': 'yes' },
  },
];

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(LOCAL_POI_SCHEMA_SQL);
  const insert = db.prepare(
    `INSERT INTO osm_pois
       (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, region_id, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nyc', 1, 1)`,
  );
  for (const f of FIXTURES) {
    insert.run(
      f.osmType,
      f.osmId,
      f.lat,
      f.lng,
      f.primaryKey,
      f.subtype,
      f.name,
      f.name.toLowerCase(),
      JSON.stringify(f.tags),
    );
  }
  return db;
}

const NYC = { south: 40.7, west: -74.02, north: 40.8, east: -73.95 };

function names(db: DatabaseSync, query: Parameters<typeof buildLocalPoiQuery>[0]): string[] {
  const { sql, params } = buildLocalPoiQuery(query);
  const rows = db.prepare(sql).all(...params) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe('local POI index queries', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns named POIs inside the bbox, nearest first', () => {
    const result = names(db, { ...NYC, requireName: true });
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('Pizzeria Sorbillo'); // closest to the bbox centre
    expect(result).not.toContain('Shell'); // London
  });

  it('filters by primary tag key', () => {
    expect(names(db, { ...NYC, keys: [{ key: 'amenity' }] })).toEqual([
      'Pizzeria Sorbillo',
      'Blue Bottle Coffee',
    ]);
    expect(names(db, { ...NYC, keys: [{ key: 'shop' }] })).toEqual(['Dominique Ansel Bakery']);
  });

  it('filters by primary tag key AND value', () => {
    expect(names(db, { ...NYC, keys: [{ key: 'amenity', value: 'cafe' }] })).toEqual([
      'Blue Bottle Coffee',
    ]);
    expect(
      names(db, {
        ...NYC,
        keys: [
          { key: 'amenity', value: 'cafe' },
          { key: 'shop', value: 'bakery' },
        ],
      }),
    ).toHaveLength(2);
  });

  it('filters on arbitrary tag keys, including ones with colons', () => {
    const london = { south: 51.45, west: -0.2, north: 51.55, east: -0.05 };
    expect(names(db, { ...london, tags: [['fuel:diesel', 'yes']] })).toEqual(['Shell']);
    expect(names(db, { ...london, tags: [['fuel:diesel', 'no']] })).toEqual([]);
    expect(names(db, { ...NYC, tags: [['addr:street', 'Bleecker St']] })).toEqual([
      'Pizzeria Sorbillo',
    ]);
  });

  it('searches names through the FTS index', () => {
    expect(names(db, { ...NYC, namePattern: 'bakery' })).toEqual(['Dominique Ansel Bakery']);
    // Prefix match on the final token.
    expect(names(db, { ...NYC, namePattern: 'blue bott' })).toEqual(['Blue Bottle Coffee']);
    expect(names(db, { ...NYC, namePattern: 'zzz' })).toEqual([]);
  });

  it('honours the limit', () => {
    const { sql, params } = buildLocalPoiQuery({ ...NYC, limit: 1 });
    const rows = db.prepare(sql).all(...params) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('matches any POI when no key filter is given', () => {
    const all = names(db, { south: -90, west: -180, north: 90, east: 180 });
    expect(all).toHaveLength(FIXTURES.length);
  });
});

describe('coverage', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(LOCAL_POI_SCHEMA_SQL);
    db.exec(`
      INSERT INTO local_poi_coverage (region_id, south, west, north, east, poi_count, updated_at)
      VALUES ('nyc', 40.0, -74.5, 41.0, -73.0, 3, 1),
             ('empty', 0, 0, 1, 1, 0, 1);
    `);
  });

  afterEach(() => db.close());

  function covered(bounds: { south: number; west: number; north: number; east: number }): number {
    const { sql, params } = buildPoiCoverageQuery(bounds);
    const row = db.prepare(sql).get(...params) as { covered: number };
    return row.covered;
  }

  it('reports coverage only when a region fully contains the box', () => {
    expect(covered({ south: 40.7, west: -74.0, north: 40.8, east: -73.9 })).toBe(1);
  });

  it('reports no coverage for a box that hangs outside the region', () => {
    expect(covered({ south: 39.0, west: -74.0, north: 40.8, east: -73.9 })).toBe(0);
  });

  it('treats a zero-POI region as no coverage', () => {
    expect(covered({ south: 0.25, west: 0.25, north: 0.75, east: 0.75 })).toBe(0);
  });
});

describe('pack import SQL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaris-poi-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('copies rows from an attached pack into the local index', () => {
    const packPath = join(dir, 'search.sqlite');
    const pack = new DatabaseSync(packPath);
    pack.exec(PACK_POI_SCHEMA_SQL);
    pack
      .prepare(
        `INSERT INTO osm_pois
           (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, version, updated_at)
         VALUES ('node', 42, 40.75, -73.98, 'amenity', 'cafe', 'Pack Cafe', 'pack cafe', '{"amenity":"cafe"}', 1, 1)`,
      )
      .run();
    pack.close();

    const db = createDb();
    db.exec(`ATTACH DATABASE '${packPath}' AS pack`);
    const importSql = `
      INSERT INTO osm_pois
        (osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, region_id, version, updated_at)
      SELECT osm_type, osm_id, lat, lng, primary_key, subtype, name, name_norm, tags_json, 'nyc', version, updated_at
        FROM pack.osm_pois
      WHERE true
      ON CONFLICT (osm_type, osm_id) DO UPDATE SET
        lat = excluded.lat,
        name = excluded.name,
        region_id = excluded.region_id
    `;
    db.exec(importSql);

    const count = () =>
      (db.prepare('SELECT COUNT(*) AS n FROM osm_pois WHERE osm_id = 42').get() as { n: number }).n;

    expect(count()).toBe(1);
    // Re-importing the same pack must not duplicate rows (UPSERT).
    db.exec(importSql);
    expect(count()).toBe(1);

    db.exec('DETACH DATABASE pack');
    db.close();
  });
});

describe('ftsQueryFromText', () => {
  it('turns words into quoted prefix terms', () => {
    expect(ftsQueryFromText('blue bottle')).toBe('"blue" AND "bottle"*');
  });

  it('strips FTS operators so user input cannot break the query', () => {
    expect(ftsQueryFromText('pizza" OR *')).toBe('"pizza" AND "or"*');
  });

  it('returns null when there is nothing to search', () => {
    expect(ftsQueryFromText('   ')).toBeNull();
    expect(ftsQueryFromText('***')).toBeNull();
  });
});
