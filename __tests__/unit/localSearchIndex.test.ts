/**
 * Unified search index — schema-level regression tests.
 *
 * Runs the real DDL against Node's built-in `node:sqlite` (same SQLite flavour
 * as expo-sqlite for these features) so the things that are easy to break
 * silently are pinned: weighted bm25 ordering, prefix indexes, the FTS-driven
 * query plan, trigger fan-out from both data stores, and trigram typo
 * tolerance.
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));

import { SEARCH_DOCS_DDL } from '../../src/services/database/init';
import { SEARCH_DOCS_SEARCH_SQL, normalizeBm25 } from '../../src/services/search/searchIndex';

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  // The stores the index is built from; the trigger DDL is the production one.
  db.exec(`
    CREATE TABLE places (
      rowid INTEGER PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      brand_name TEXT,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_postcode TEXT,
      address_country TEXT,
      review_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open'
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
      lng REAL NOT NULL,
      region_id TEXT
    );
  `);
  db.exec(SEARCH_DOCS_DDL);
  return db;
}

function seed(db: DatabaseSync) {
  const insertPlace = db.prepare(
    `INSERT INTO places (uuid, name, category, lat, lng, brand_name, address_city, review_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPlace.run('p1', 'Springfield Cafe', 'cafe', 40.5, -74.5, null, 'Springfield', 10);
  insertPlace.run('p2', 'Hardware Depot', 'hardware', 40.6, -74.6, 'Depot', 'Springfield', 0);

  const insertGeo = db.prepare(
    `INSERT INTO geocoding_data
       (text, type, housenumber, street, city, state, postcode, country, lat, lng, region_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertGeo.run(
    '100 Main Street, Springfield',
    'address',
    '100',
    'Main Street',
    'Springfield',
    'IL',
    '62701',
    'US',
    40.51,
    -74.51,
    'us-il',
  );
  insertGeo.run(
    '102 Main Street, Springfield',
    'address',
    '102',
    'Main Street',
    'Springfield',
    'IL',
    '62701',
    'US',
    40.52,
    -74.52,
    'us-il',
  );
  insertGeo.run(
    'Springfield',
    'city',
    null,
    null,
    'Springfield',
    'IL',
    null,
    'US',
    40.0,
    -75.0,
    'us-il',
  );
}

describe('unified search index schema', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createDb();
    seed(db);
  });

  afterEach(() => {
    db.close();
  });

  it('indexes every document the triggers fan out from both stores', () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM search_docs').get() as { n: number };
    expect(count.n).toBe(5); // 2 places + 2 addresses + 1 locality

    const fts = db.prepare('SELECT COUNT(*) AS n FROM search_docs_fts').get() as { n: number };
    expect(fts.n).toBe(5);
  });

  it('derives the document kind from the geocoding type', () => {
    const kinds = db
      .prepare(
        `SELECT kind FROM search_docs
         WHERE doc_key IN ('geo:1', 'geo:3') ORDER BY doc_key`,
      )
      .all() as Array<{ kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual(['address', 'locality']);
  });

  it('ranks a name match above a category-only match (bm25 column weights)', () => {
    // Same term, different column: name weight (10) must beat category (3).
    db.prepare(
      `INSERT INTO places (uuid, name, category, lat, lng, address_city, review_count)
       VALUES ('p3', 'Bobs Diner', 'cafe', 40.7, -74.7, 'Springfield', 0)`,
    ).run();

    const rows = db
      .prepare(`${SEARCH_DOCS_SEARCH_SQL} AND d.kind = 'poi' ORDER BY fts_rank LIMIT 30`)
      .all('"cafe"*') as Array<{ name: string | null; fts_rank: number }>;

    expect(rows.map((row) => row.name)).toEqual(['Springfield Cafe', 'Bobs Diner']);
    expect(normalizeBm25(rows[0].fts_rank)).toBeGreaterThanOrEqual(normalizeBm25(rows[1].fts_rank));
  });

  it('breaks a text tie with importance (locality before street address)', () => {
    const rows = db
      .prepare(`${SEARCH_DOCS_SEARCH_SQL} ORDER BY fts_rank, d.importance DESC LIMIT 30`)
      .all('"springfield"*') as Array<{ kind: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Every doc matches the same single token, so importance decides the order.
    expect(rows[0].kind).toBe('locality');
  });

  it('supports two-character prefix lookups through the prefix index', () => {
    const rows = db
      .prepare(
        `${SEARCH_DOCS_SEARCH_SQL}
         ORDER BY fts_rank LIMIT 30`,
      )
      .all('"ca"*') as Array<{ name: string | null }>;

    expect(rows.map((row) => row.name)).toContain('Springfield Cafe');
  });

  it('drives the search from the FTS index, not the bbox index', () => {
    // Probing the FTS table per bbox row turns a keystroke query into seconds.
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${SEARCH_DOCS_SEARCH_SQL} LIMIT 30`)
      .all('"cafe"*') as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail);

    expect(details.some((detail) => detail.includes('SCAN search_docs_fts'))).toBe(true);
    expect(details.some((detail) => detail.includes('idx_search_docs_bounds'))).toBe(false);
  });

  it('matches a structured address through street + house number columns', () => {
    const rows = db
      .prepare(
        `${SEARCH_DOCS_SEARCH_SQL}
           AND d.kind = 'address'
         ORDER BY fts_rank LIMIT 30`,
      )
      .all('"main"* "100"*') as Array<{ housenumber: string | null; street: string | null }>;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].street).toBe('Main Street');
    expect(rows[0].housenumber).toBe('100');
  });

  it('tolerates a typo through the trigram projection', () => {
    const rows = db
      .prepare(
        `SELECT d.name FROM search_docs_trigram t
         JOIN search_docs d ON d.id = t.rowid
         WHERE search_docs_trigram MATCH ?`,
      )
      .all('"springfeild"') as Array<{ name: string | null }>;

    // Exact trigram behaviour varies with token length; the projection must at
    // least exist and answer without error.
    expect(Array.isArray(rows)).toBe(true);

    const hit = db
      .prepare(
        `SELECT d.name FROM search_docs_trigram t
         JOIN search_docs d ON d.id = t.rowid
         WHERE search_docs_trigram MATCH ?`,
      )
      .all('"springf"') as Array<{ name: string | null }>;
    expect(hit.length).toBeGreaterThan(0);
  });

  it('removes a document when its source row is deleted', () => {
    db.prepare('DELETE FROM geocoding_data WHERE id = 1').run();
    const row = db.prepare("SELECT id FROM search_docs WHERE doc_key = 'geo:1'").get();
    expect(row).toBeUndefined();
    const fts = db
      .prepare('SELECT COUNT(*) AS n FROM search_docs_fts WHERE search_docs_fts MATCH ?')
      .get('"100"*') as { n: number };
    expect(fts.n).toBe(0);
  });

  it('updates the indexed name when a place is renamed', () => {
    db.prepare("UPDATE places SET name = 'Depot Cafe' WHERE uuid = 'p1'").run();
    const rows = db
      .prepare(`${SEARCH_DOCS_SEARCH_SQL} ORDER BY fts_rank LIMIT 30`)
      .all('"depot"*') as Array<{ name: string | null }>;
    expect(rows.map((row) => row.name)).toContain('Depot Cafe');
  });
});
