/**
 * Reverse geocoding runs on the R*Tree, in real SQLite.
 *
 * `geocoding_data` is written by region-pack imports and holds hundreds of
 * thousands of rows per metro once interpolated house numbers are expanded, so
 * a "nearest row in a box" query without an index is a full table scan on every
 * dropped pin. These tests execute the real DDL, the real triggers and the real
 * query against node:sqlite, so a regression in any of the three fails here
 * rather than in the field.
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => ({}));

import {
  GEOCODING_RTREE_DDL,
  GEOCODING_RTREE_TRIGGERS,
  migrateGeocodingRtree,
} from '../../src/services/database/init';
import {
  longitudeWeight,
  reverseQueryParams,
  reverseQuerySql,
  reverseTiers,
  searchWindow,
} from '../../src/services/geocoding/reverseQuery';

/** `geocoding_data` as the app creates it (region_id arrives by migration). */
const GEOCODING_DATA_DDL = `
  CREATE TABLE geocoding_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    type TEXT NOT NULL,
    housenumber TEXT,
    street TEXT,
    city TEXT,
    state TEXT,
    postcode TEXT,
    country TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    region_id TEXT
  );
`;

type MigrationDb = Parameters<typeof migrateGeocodingRtree>[0];

/** Adapt node:sqlite to the two calls the migration makes. */
function asMigrationDb(db: DatabaseSync): MigrationDb {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) =>
      (db.prepare(sql).get(...(params as never[])) as never) ?? null,
  } as unknown as MigrationDb;
}

const BOSTON = { lat: 42.3554, lng: -71.0652 };

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(GEOCODING_DATA_DDL);
  return db;
}

function insertAddress(
  db: DatabaseSync,
  row: { text: string; type?: string; lat: number; lng: number; street?: string; city?: string },
): void {
  db.prepare(
    `INSERT INTO geocoding_data (text, type, housenumber, street, city, state, postcode, country, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.text,
    row.type ?? 'address',
    null,
    row.street ?? null,
    row.city ?? null,
    'MA',
    '02108',
    'USA',
    row.lat,
    row.lng,
  );
}

/** Nearest row for one tier, exactly as the service issues it. */
function nearest(
  db: DatabaseSync,
  lat: number,
  lng: number,
  radiusKm: number,
  predicate: 'address' | 'other',
) {
  return db
    .prepare(reverseQuerySql(predicate))
    .get(
      ...(reverseQueryParams(
        lat,
        lng,
        searchWindow(lat, lng, radiusKm),
        longitudeWeight(lat),
      ) as never[]),
    ) as Record<string, unknown> | undefined;
}

describe('geocoding_rtree schema', () => {
  it('creates the index and the trigger families together', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(GEOCODING_DATA_DDL);
    db.exec(GEOCODING_RTREE_DDL);
    db.exec(GEOCODING_RTREE_TRIGGERS);

    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all() as {
        name: string;
      }[]
    ).map((row) => row.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'geocoding_rtree',
        'geocoding_rtree_insert',
        'geocoding_rtree_delete',
        'geocoding_rtree_update',
      ]),
    );
  });

  it('keeps the index level with inserts, deletes and moves', () => {
    const db = freshDb();
    db.exec(GEOCODING_RTREE_DDL);
    db.exec(GEOCODING_RTREE_TRIGGERS);

    insertAddress(db, { text: '10 Beacon St', lat: BOSTON.lat, lng: BOSTON.lng });
    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 1 });

    db.exec('UPDATE geocoding_data SET lat = 40.0, lng = -75.0 WHERE id = 1');
    expect(nearest(db, 40.0, -75.0, 0.5, 'address')?.text).toBe('10 Beacon St');
    expect(nearest(db, BOSTON.lat, BOSTON.lng, 0.5, 'address')).toBeUndefined();

    db.exec('DELETE FROM geocoding_data WHERE id = 1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 0 });
  });
});

describe('migrateGeocodingRtree', () => {
  it('backfills rows that predate the index', async () => {
    const db = freshDb();
    insertAddress(db, { text: '1 Park St', lat: BOSTON.lat, lng: BOSTON.lng });
    insertAddress(db, { text: '2 Park St', lat: BOSTON.lat + 0.001, lng: BOSTON.lng });

    await migrateGeocodingRtree(asMigrationDb(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 2 });
    expect(nearest(db, BOSTON.lat, BOSTON.lng, 0.5, 'address')?.text).toBe('1 Park St');
  });

  it('repairs a partially filled index instead of duplicating it', async () => {
    const db = freshDb();
    db.exec(GEOCODING_RTREE_DDL);
    db.exec(GEOCODING_RTREE_TRIGGERS);

    // Simulate an app killed mid-backfill: rows on disk, index empty.
    db.exec('DROP TRIGGER geocoding_rtree_insert');
    insertAddress(db, { text: '1 Park St', lat: BOSTON.lat, lng: BOSTON.lng });
    insertAddress(db, { text: '2 Park St', lat: BOSTON.lat + 0.001, lng: BOSTON.lng });
    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 0 });

    await migrateGeocodingRtree(asMigrationDb(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 2 });
  });

  it('is a no-op on an index that is already complete', async () => {
    const db = freshDb();
    db.exec(GEOCODING_RTREE_DDL);
    db.exec(GEOCODING_RTREE_TRIGGERS);
    insertAddress(db, { text: '1 Park St', lat: BOSTON.lat, lng: BOSTON.lng });

    await migrateGeocodingRtree(asMigrationDb(db));
    await migrateGeocodingRtree(asMigrationDb(db));

    expect(db.prepare('SELECT COUNT(*) AS n FROM geocoding_rtree').get()).toEqual({ n: 1 });
  });
});

describe('reverse query', () => {
  /**
   * Addresses and named places interleaved, so "nearest" alone and "most
   * specific" give different answers.
   */
  function seeded(): DatabaseSync {
    const db = freshDb();
    db.exec(GEOCODING_RTREE_DDL);
    db.exec(GEOCODING_RTREE_TRIGGERS);

    // 400 m away: a second address, so "nearest" is a real choice.
    insertAddress(db, {
      text: '100 Tremont St',
      lat: BOSTON.lat + 0.0036,
      lng: BOSTON.lng,
      street: 'Tremont St',
      city: 'Boston',
    });
    // 5.5 km north, alone: a named place with no address anywhere near it.
    insertAddress(db, {
      text: 'Boston Common',
      type: 'place',
      lat: BOSTON.lat + 0.05,
      lng: BOSTON.lng,
      city: 'Boston',
    });
    // 6 m away: the address the pin is standing on.
    insertAddress(db, {
      text: '45 School St',
      lat: BOSTON.lat + 0.00005,
      lng: BOSTON.lng,
      street: 'School St',
      city: 'Boston',
    });
    return db;
  }

  it('prefers the address the pin is on over a nearer named place', () => {
    const db = seeded();
    expect(nearest(db, BOSTON.lat, BOSTON.lng, 0.5, 'address')?.id).toBe(3);
  });

  it('answers with the named feature when no address is within the radius', () => {
    const db = seeded();
    // Standing on the feature: the nearest address is >5 km away, so the
    // address tier finds nothing and the 'other' tier answers.
    const lat = BOSTON.lat + 0.05;
    expect(nearest(db, lat, BOSTON.lng, 0.5, 'address')).toBeUndefined();
    expect(nearest(db, lat, BOSTON.lng, 0.5, 'other')?.text).toBe('Boston Common');
  });

  it('is served by the R*Tree rather than a table scan', () => {
    const db = seeded();
    const plan = (
      db
        .prepare(`EXPLAIN QUERY PLAN ${reverseQuerySql('address')}`)
        .all(
          ...(reverseQueryParams(
            BOSTON.lat,
            BOSTON.lng,
            searchWindow(BOSTON.lat, BOSTON.lng, 0.5),
            longitudeWeight(BOSTON.lat),
          ) as never[]),
        ) as { detail: string }[]
    )
      .map((row) => row.detail)
      .join('\n');

    // A pushed-down R*Tree constraint shows up as `VIRTUAL TABLE INDEX`;
    // losing the index turns this into `SCAN r VIRTUAL TABLE` with no index.
    expect(plan).toMatch(/VIRTUAL TABLE INDEX/);
  });

  it('finds nothing beyond the window instead of scanning the world', () => {
    const db = seeded();
    expect(nearest(db, 40.0, -75.0, 0.5, 'address')).toBeUndefined();
  });
});

describe('reverseTiers', () => {
  it('widens monotonically from the most specific answer', () => {
    const tiers = reverseTiers(0.5);
    const radii = tiers.map((tier) => tier.radiusKm);

    expect(tiers[0]).toEqual({ predicate: 'address', radiusKm: 0.5 });
    expect(tiers[1].predicate).toBe('other');
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]!);
    }
  });

  it('always ends with a region-scale tier so a pin cannot resolve to nothing', () => {
    const last = reverseTiers(0.5).at(-1)!;
    expect(last.predicate).toBe('other');
    expect(last.radiusKm).toBeGreaterThanOrEqual(100);
  });

  it('falls back to the default radius for a zero or negative request', () => {
    expect(reverseTiers(0)[0].radiusKm).toBe(0.5);
    expect(reverseTiers(-3)[0].radiusKm).toBe(0.5);
  });
});
