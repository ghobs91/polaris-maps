/**
 * Viewport place lookup (`getPlacesInBounds`).
 *
 * Runs the real function against an in-memory `node:sqlite` database built with
 * the app's `places` schema, then verifies both the result semantics (bbox +
 * open-status + rating ordering + limit) and that the query is served by
 * `idx_places_bounds` (via EXPLAIN QUERY PLAN).
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('../../src/services/gun/init', () => ({ getGun: jest.fn() }));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({ getOrCreateKeypair: jest.fn() }));
jest.mock('../../src/services/database/init', () => {
  const db = { getAllAsync: jest.fn(), getFirstAsync: jest.fn(), runAsync: jest.fn() };
  return { getDatabase: jest.fn().mockResolvedValue(db), __mockDb: db };
});

import { getPlacesInBounds } from '../../src/services/poi/poiService';

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: { getAllAsync: jest.Mock };
};

function createDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE places (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      geohash8 TEXT NOT NULL,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_postcode TEXT,
      address_country TEXT,
      phone TEXT,
      website TEXT,
      social_media TEXT,
      emails TEXT,
      brand_name TEXT,
      hours TEXT,
      avg_rating REAL,
      review_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL,
      author_pubkey TEXT,
      signature TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_places_bounds ON places (status, lat, lng);
  `);

  const insert = db.prepare(
    `INSERT INTO places (uuid, name, category, lat, lng, geohash8, avg_rating, status, source, created_at, updated_at)
     VALUES (?, ?, 'cafe', ?, ?, 'dr5regy', ?, ?, 'overture', 1, 1)`,
  );
  insert.run('in-high', 'Inside High', 40.7, -74.0, 4.5, 'open');
  insert.run('in-low', 'Inside Low', 40.698, -74.002, 3.0, 'open');
  insert.run('in-null', 'Inside No Rating', 40.702, -73.998, null, 'open');
  insert.run('out-lat', 'Outside Latitude', 40.8, -74.0, 5.0, 'open');
  insert.run('out-lng', 'Outside Longitude', 40.7, -73.9, 5.0, 'open');
  insert.run('closed', 'Closed Inside', 40.7, -74.0, 5.0, 'closed');
  return db;
}

const VIEWPORT = { south: 40.69, north: 40.71, west: -74.01, east: -73.99 };

describe('getPlacesInBounds', () => {
  let sqlite: DatabaseSync;

  beforeEach(() => {
    jest.clearAllMocks();
    sqlite = createDb();
    mockDb.getAllAsync.mockImplementation(async (sql: string, params: unknown[]) =>
      sqlite.prepare(sql).all(...params),
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns open places inside the bbox, ordered by rating with nulls last', async () => {
    const places = await getPlacesInBounds(
      VIEWPORT.south,
      VIEWPORT.west,
      VIEWPORT.north,
      VIEWPORT.east,
      100,
    );

    expect(places.map((p) => p.uuid)).toEqual(['in-high', 'in-low', 'in-null']);
    expect(places[0].avgRating).toBe(4.5);
  });

  it('forwards the bbox and limit to the query', async () => {
    await getPlacesInBounds(VIEWPORT.south, VIEWPORT.west, VIEWPORT.north, VIEWPORT.east, 2);

    const [, params] = mockDb.getAllAsync.mock.calls[0];
    expect(params).toEqual([VIEWPORT.south, VIEWPORT.north, VIEWPORT.west, VIEWPORT.east, 2]);
  });

  it('honours the limit', async () => {
    const places = await getPlacesInBounds(
      VIEWPORT.south,
      VIEWPORT.west,
      VIEWPORT.north,
      VIEWPORT.east,
      2,
    );
    expect(places.map((p) => p.uuid)).toEqual(['in-high', 'in-low']);
  });

  it('is served by the places bounds index', async () => {
    await getPlacesInBounds(VIEWPORT.south, VIEWPORT.west, VIEWPORT.north, VIEWPORT.east, 100);

    const [sql, params] = mockDb.getAllAsync.mock.calls[0];
    const plan = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((row) => (row as { detail: string }).detail)
      .join(' | ');

    expect(plan).toContain('idx_places_bounds');
  });
});
