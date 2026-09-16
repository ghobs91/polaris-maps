/**
 * Local search index behavior tests.
 *
 * Uses Node's built-in `node:sqlite` (same SQLite flavor as expo-sqlite for
 * these features) to exercise the real FTS5 schema: weighted bm25 relevance,
 * prefix indexes, structured address column filters, distance ranking, and
 * trigram typo tolerance.
 */

import { DatabaseSync } from 'node:sqlite';

// The modules under test import native/expo dependencies only for runtime
// queries; this suite exercises the SQL schema directly with node:sqlite.
jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));

import {
  classifyAddressQuery,
  sortRowsByDistance,
} from '../../src/services/geocoding/geocodingService';
import { normalizeBm25 } from '../../src/services/poi/poiService';

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE places (
      rowid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      brand_name TEXT,
      address_city TEXT
    );
    CREATE VIRTUAL TABLE places_fts USING fts5(
      name, brand_name, category, address_city,
      content='places', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
    );
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
      lng REAL NOT NULL
    );
    CREATE VIRTUAL TABLE geocoding_entries USING fts5(
      text, type, housenumber, street, city, state, postcode, country,
      content='geocoding_data', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
    );
    CREATE VIRTUAL TABLE geocoding_trigram USING fts5(
      text, street, city,
      content='geocoding_data', content_rowid='id',
      tokenize='trigram'
    );
  `);
  return db;
}

function seedPlaces(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO places (name, category, lat, lng, brand_name, address_city)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insert.run('Springfield Cafe', 'cafe', 40.7, -74.0, null, 'Boston');
  insert.run('Boston Diner', 'restaurant', 40.7, -74.0, null, 'Springfield');
  insert.run('Coffee Grind', 'cafe', 40.7, -74.0, null, 'Boston');
  db.exec("INSERT INTO places_fts(places_fts) VALUES('rebuild')");
}

function seedGeocoding(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO geocoding_data (text, type, housenumber, street, city, state, postcode, country, lat, lng)
     VALUES (?, 'address', ?, ?, ?, 'NY', '10001', 'USA', ?, ?)`,
  );
  insert.run('123 Main Street, New York, NY', '123', 'Main Street', 'New York', 40.75, -73.99);
  insert.run('123 Main Street, Brooklyn, NY', '123', 'Main Street', 'Brooklyn', 40.702, -73.99);
  db.exec("INSERT INTO geocoding_entries(geocoding_entries) VALUES('rebuild')");
  db.exec("INSERT INTO geocoding_trigram(geocoding_trigram) VALUES('rebuild')");
}

describe('local search index', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createDb();
    seedPlaces(db);
    seedGeocoding(db);
  });

  afterEach(() => {
    db.close();
  });

  it('ranks a name match above a city match via bm25 column weights', () => {
    const rows = db
      .prepare(
        `SELECT p.rowid, p.name, bm25(places_fts, 10.0, 6.0, 2.0, 1.0) AS r
         FROM places p JOIN places_fts ON places_fts.rowid = p.rowid
         WHERE places_fts MATCH ?
         ORDER BY r`,
      )
      .all('"springfield"*') as Array<{ rowid: number; name: string; r: number }>;

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Springfield Cafe');
    // More negative bm25 = better; the normalized signal must agree.
    expect(normalizeBm25(rows[0].r)).toBeGreaterThan(normalizeBm25(rows[1].r));
  });

  it('supports two-character prefix lookups through the prefix index', () => {
    const rows = db
      .prepare(
        `SELECT p.name FROM places p JOIN places_fts ON places_fts.rowid = p.rowid
         WHERE places_fts MATCH ? ORDER BY bm25(places_fts)`,
      )
      .all('"co"*') as Array<{ name: string }>;

    expect(rows.map((r) => r.name)).toContain('Coffee Grind');
  });

  it('matches structured address column filters', () => {
    const rows = db
      .prepare(
        `SELECT g.id FROM geocoding_entries e JOIN geocoding_data g ON g.id = e.rowid
         WHERE geocoding_entries MATCH ?`,
      )
      .all('{housenumber}:"123"* {street}:"main"* {street}:"street"* {city}:"brooklyn"*') as Array<{
      id: number;
    }>;

    expect(rows).toHaveLength(1);
  });

  it('ranks the nearest address first', () => {
    const rows = db
      .prepare('SELECT id, lat, lng FROM geocoding_data WHERE street = ?')
      .all('Main Street') as Array<{ id: number; lat: number; lng: number }>;

    const sorted = sortRowsByDistance(rows, 40.702, -73.99);
    expect(sorted[0].id).toBe(rows[1].id);
  });

  it('finds a misspelled street through the trigram index', () => {
    const rows = db
      .prepare(
        `SELECT g.text FROM geocoding_trigram t JOIN geocoding_data g ON g.id = t.rowid
         WHERE geocoding_trigram MATCH ?`,
      )
      .all('"123 main stree"') as Array<{ text: string }>;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].text).toContain('Main Street');
  });
});

describe('classifyAddressQuery', () => {
  it('extracts house number, street, and city', () => {
    expect(classifyAddressQuery('350 Fifth Avenue, New York')).toEqual({
      housenumber: '350',
      street: 'fifth avenue',
      city: 'new york',
    });
  });

  it('handles street-only and comma-less queries', () => {
    expect(classifyAddressQuery('Main Street')).toEqual({ street: 'main street' });
    expect(classifyAddressQuery('123 Main St Brooklyn')).toEqual({
      housenumber: '123',
      street: 'main st brooklyn',
    });
  });
});
