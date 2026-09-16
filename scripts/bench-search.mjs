#!/usr/bin/env node
/**
 * Search benchmark — synthetic places/geocoding SQLite database.
 *
 * Measures the local search paths used by the app so that changes to the FTS
 * configuration (prefix indexes, trigram tables) and to Overture upserts
 * (incremental FTS maintenance vs full rebuild) can be compared on the same
 * fixture.
 *
 * Usage:
 *   node scripts/bench-search.mjs [--rows=100000] [--places-fts=v2|baseline]
 *     [--trigram=on|off] [--iterations=20] [--seed=42]
 *
 * Output: JSON with p50/p95 per measurement on stdout. Progress/log lines
 * are written to stderr so the JSON can be piped.
 *
 * Requires Node 22.5+ (`node:sqlite`), no dependencies.
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    rows: 100_000,
    geocodingRows: 30_000,
    placesFts: 'v2',
    trigram: true,
    iterations: 20,
    seed: 42,
  };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    switch (key) {
      case 'rows':
        args.rows = Number(value);
        break;
      case 'geocoding-rows':
        args.geocodingRows = Number(value);
        break;
      case 'places-fts':
        args.placesFts = value === 'baseline' ? 'baseline' : 'v2';
        break;
      case 'trigram':
        args.trigram = value !== 'off';
        break;
      case 'iterations':
        args.iterations = Number(value);
        break;
      case 'seed':
        args.seed = Number(value);
        break;
      default:
        throw new Error(`Unknown argument: ${raw}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG + synthetic data
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS = [
  'Starbucks',
  'Dunkin',
  'McDonalds',
  'Burger King',
  'Taco Bell',
  'Chipotle',
  'Subway',
  'Wendys',
  'Panera Bread',
  'Walmart',
  'Target',
  'Costco',
  'Kroger',
  'CVS',
  'Walgreens',
  'Shell',
  'Exxon',
  'Chase',
  'Planet Fitness',
  'Marriott',
  'Hilton',
  '',
];

const NOUNS = [
  'Coffee',
  'Cafe',
  'Pizza',
  'Deli',
  'Bagels',
  'Diner',
  'Grill',
  'Bistro',
  'Kitchen',
  'Market',
  'Pharmacy',
  'Cleaners',
  'Salon',
  'Barber',
  'Auto',
  'Books',
  'Florist',
  'Bakery',
  'Tavern',
  'Pizzeria',
];

const STREETS = [
  'Main Street',
  'Broadway',
  'Oak Avenue',
  'Maple Drive',
  'Washington Boulevard',
  'Park Place',
  'Elm Street',
  'Cedar Lane',
  'Pine Road',
  'Lake Court',
  'Hill Terrace',
  'River Way',
  'Sunset Park',
  'Highland Trail',
  'Center Square',
];

const CITIES = [
  ['New York', 'NY', '10001', 40.7128, -74.006],
  ['Los Angeles', 'CA', '90001', 34.0522, -118.2437],
  ['Chicago', 'IL', '60601', 41.8781, -87.6298],
  ['Houston', 'TX', '77001', 29.7604, -95.3698],
  ['Phoenix', 'AZ', '85001', 33.4484, -112.074],
  ['Philadelphia', 'PA', '19101', 39.9526, -75.1652],
  ['San Antonio', 'TX', '78201', 29.4241, -98.4936],
  ['San Diego', 'CA', '92101', 32.7157, -117.1611],
  ['Dallas', 'TX', '75201', 32.7767, -96.797],
  ['Brooklyn', 'NY', '11201', 40.6782, -73.9442],
];

const CATEGORIES = [
  'cafe',
  'restaurant',
  'fast_food',
  'grocery',
  'supermarket',
  'pharmacy',
  'gas_station',
  'bank',
  'gym',
  'hotel',
  'parking',
  'park',
];

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashEncode(lat, lng, precision = 8) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function seedPlaces(db, rows, rng) {
  const insert = db.prepare(
    `INSERT INTO places (uuid, name, category, lat, lng, geohash8,
       address_street, address_city, address_state, address_postcode, address_country,
       phone, website, social_media, emails, brand_name, hours, avg_rating, review_count,
       status, source, author_pubkey, signature, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  for (let i = 0; i < rows; i++) {
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const brand = BRANDS[Math.floor(rng() * BRANDS.length)];
    const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
    const street = STREETS[Math.floor(rng() * STREETS.length)];
    const name = brand ? `${brand} ${noun}` : `${noun} ${Math.floor(rng() * 1000)}`;
    const lat = city[3] + (rng() - 0.5) * 0.5;
    const lng = city[4] + (rng() - 0.5) * 0.5;
    insert.run(
      `overture:${i}`,
      name,
      CATEGORIES[Math.floor(rng() * CATEGORIES.length)],
      lat,
      lng,
      geohashEncode(lat, lng, 8),
      `${Math.floor(rng() * 9000) + 100} ${street}`,
      city[0],
      city[1],
      city[2],
      'USA',
      null,
      null,
      null,
      null,
      brand || null,
      null,
      rng() > 0.4 ? 3 + rng() * 2 : null,
      Math.floor(rng() * 2000),
      'open',
      'overture',
      null,
      null,
      1_700_000_000,
      1_700_000_000,
    );
  }
  db.exec('COMMIT');
  db.exec("INSERT INTO places_fts(places_fts) VALUES('rebuild')");
}

function seedGeocoding(db, rows, rng) {
  const insert = db.prepare(
    `INSERT INTO geocoding_data (text, type, housenumber, street, city, state, postcode, country, lat, lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  for (let i = 0; i < rows; i++) {
    const city = CITIES[Math.floor(rng() * CITIES.length)];
    const street = STREETS[Math.floor(rng() * STREETS.length)];
    const housenumber = String(Math.floor(rng() * 9000) + 100);
    const lat = city[3] + (rng() - 0.5) * 0.5;
    const lng = city[4] + (rng() - 0.5) * 0.5;
    insert.run(
      `${housenumber} ${street}, ${city[0]}, ${city[1]}, ${city[2]}`,
      'address',
      housenumber,
      street,
      city[0],
      city[1],
      city[2],
      'USA',
      lat,
      lng,
    );
  }
  db.exec('COMMIT');
  db.exec("INSERT INTO geocoding_entries(geocoding_entries) VALUES('rebuild')");
  if (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='geocoding_trigram'")
      .get()
  ) {
    db.exec("INSERT INTO geocoding_trigram(geocoding_trigram) VALUES('rebuild')");
  }
}

// ---------------------------------------------------------------------------
// Schema (mirrors src/services/database/init.ts)
// ---------------------------------------------------------------------------

function createSchema(db, { placesFts, trigram }) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

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
    CREATE INDEX idx_places_geohash ON places (geohash8);
    CREATE INDEX idx_places_category ON places (category, geohash8);

    CREATE VIRTUAL TABLE places_fts USING fts5(
      name,
      brand_name,
      category,
      address_city,
      content='places',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'${placesFts === 'v2' ? ",\n      prefix='2 3 4'" : ''}
    );
    CREATE TRIGGER places_fts_insert AFTER INSERT ON places BEGIN
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;
    CREATE TRIGGER places_fts_delete AFTER DELETE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
    END;
    CREATE TRIGGER places_fts_update AFTER UPDATE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;

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
      text,
      type,
      housenumber,
      street,
      city,
      state,
      postcode,
      country,
      content='geocoding_data',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'${placesFts === 'v2' ? ",\n      prefix='2 3 4'" : ''}
    );
  `);

  if (trigram) {
    try {
      db.exec(`
        CREATE VIRTUAL TABLE geocoding_trigram USING fts5(
          text,
          content='geocoding_data',
          content_rowid='id',
          tokenize='trigram'
        );
      `);
    } catch (err) {
      process.stderr.write(`trigram tokenizer unavailable: ${err.message}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function measure(name, fn, iterations) {
  const samples = [];
  let resultCount = null;
  const warmups = Math.min(3, Math.max(1, iterations - 1));
  for (let i = 0; i < warmups; i++) {
    const result = fn();
    resultCount = Array.isArray(result) ? result.length : null;
  }
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = fn();
    samples.push(performance.now() - start);
    resultCount = Array.isArray(result) ? result.length : null;
  }
  samples.sort((a, b) => a - b);
  return {
    p50Ms: Number(percentile(samples, 50).toFixed(3)),
    p95Ms: Number(percentile(samples, 95).toFixed(3)),
    resultCount,
    iterations,
  };
}

const BBOX = { south: 40.4, north: 41.0, west: -74.3, east: -73.7 };

function run(db, args) {
  const measurementIterations = Math.max(1, args.iterations);
  const ftsQuery = db.prepare(
    `SELECT p.uuid, p.name FROM places p
     JOIN places_fts ON places_fts.rowid = p.rowid
     WHERE places_fts MATCH ?
       AND p.lat BETWEEN ? AND ?
       AND p.lng BETWEEN ? AND ?
       AND p.status = 'open'
     ORDER BY places_fts.rank
     LIMIT 30`,
  );
  const structuredQuery = db.prepare(
    `SELECT g.id, g.text,
            ((g.lat - ?) * (g.lat - ?) + (g.lng - ?) * (g.lng - ?)) AS dist
     FROM geocoding_entries e
     JOIN geocoding_data g ON g.id = e.rowid
     WHERE geocoding_entries MATCH ?
     ORDER BY dist
     LIMIT 20`,
  );
  const trigramStmt = db.prepare(
    `SELECT g.id, g.text FROM geocoding_trigram t
     JOIN geocoding_data g ON g.id = t.rowid
     WHERE geocoding_trigram MATCH ?
     LIMIT 20`,
  );

  const measurements = {
    fts_name_prefix: measure(
      'fts_name_prefix',
      () => ftsQuery.all('"coffee"*', BBOX.south, BBOX.north, BBOX.west, BBOX.east),
      measurementIterations,
    ),
    fts_two_char_prefix: measure(
      'fts_two_char_prefix',
      () => ftsQuery.all('"co"*', BBOX.south, BBOX.north, BBOX.west, BBOX.east),
      measurementIterations,
    ),
    structured_address_fts: measure(
      'structured_address_fts',
      () =>
        structuredQuery.all(
          40.71,
          40.71,
          -74.0,
          -74.0,
          '{street}:"main street" AND {city}:"new york"',
        ),
      measurementIterations,
    ),
  };

  const hasTrigram = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='geocoding_trigram'")
    .get();
  if (hasTrigram) {
    measurements.trigram_typo_lookup = measure(
      'trigram_typo_lookup',
      () => trigramStmt.all('"ain stree"'),
      measurementIterations,
    );
  }
  // Incremental upsert of 200 new rows + per-row FTS maintenance. Mirrors the
  // app's Overture path: triggers are dropped during the bulk write and FTS
  // rows are maintained explicitly for exactly the written rowids.
  db.exec(`
    DROP TRIGGER IF EXISTS places_fts_insert;
    DROP TRIGGER IF EXISTS places_fts_update;
  `);
  const insert = db.prepare(
    `INSERT INTO places (uuid, name, category, lat, lng, geohash8, address_city, status, source, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'overture', 0, 1, 1)
     RETURNING rowid, name, brand_name, category, address_city`,
  );
  const selectExisting = db.prepare(
    'SELECT rowid, name, brand_name, category, address_city FROM places WHERE uuid = ?',
  );
  const ftsDelete = db.prepare(
    `INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
     VALUES ('delete', ?, ?, ?, ?, ?)`,
  );
  const ftsInsert = db.prepare(
    `INSERT INTO places_fts(rowid, name, brand_name, category, address_city) VALUES (?, ?, ?, ?, ?)`,
  );
  let upsertBatch = 0;
  measurements.upsert_incremental_200 = measure(
    'upsert_incremental_200',
    () => {
      db.exec('BEGIN');
      for (let i = 0; i < 200; i++) {
        const n = upsertBatch * 200 + i;
        const uuid = `bench:${n}`;
        const previous = selectExisting.get(uuid);
        const row = insert.get(
          uuid,
          `Benchmark Place ${n}`,
          'cafe',
          40.7,
          -74.0,
          geohashEncode(40.7, -74.0, 8),
          'New York',
        );
        if (previous) {
          ftsDelete.run(
            previous.rowid,
            previous.name,
            previous.brand_name,
            previous.category,
            previous.address_city,
          );
        }
        ftsInsert.run(row.rowid, row.name, row.brand_name, row.category, row.address_city);
      }
      db.exec('COMMIT');
      upsertBatch++;
      return [];
    },
    5,
  );
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS places_fts_insert AFTER INSERT ON places BEGIN
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END;
    CREATE TRIGGER IF NOT EXISTS places_fts_update AFTER UPDATE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, brand_name, category, address_city)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.brand_name, OLD.category, OLD.address_city);
      INSERT INTO places_fts(rowid, name, brand_name, category, address_city)
        VALUES (NEW.rowid, NEW.name, NEW.brand_name, NEW.category, NEW.address_city);
    END
  `);

  // Full FTS rebuild (baseline Overture path) — expensive, few iterations.
  measurements.fts_full_rebuild = measure(
    'fts_full_rebuild',
    () => {
      db.exec("INSERT INTO places_fts(places_fts) VALUES('rebuild')");
      return [];
    },
    2,
  );

  return measurements;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);
const rng = mulberry32(args.seed);
const dir = mkdtempSync(join(tmpdir(), 'polaris-search-bench-'));
const dbPath = join(dir, 'bench.sqlite');
const db = new DatabaseSync(dbPath);

try {
  process.stderr.write(
    `seeding ${args.rows} places + ${args.geocodingRows} geocoding rows ` +
      `(places-fts=${args.placesFts}, trigram=${args.trigram ? 'on' : 'off'})...\n`,
  );
  createSchema(db, { placesFts: args.placesFts, trigram: args.trigram });
  seedPlaces(db, args.rows, rng);
  seedGeocoding(db, args.geocodingRows, rng);

  const measurements = run(db, args);
  const stats = statSync(dbPath);

  const output = {
    config: {
      node: process.version,
      rows: args.rows,
      geocodingRows: args.geocodingRows,
      placesFts: args.placesFts,
      trigram: args.trigram,
      iterations: args.iterations,
      seed: args.seed,
      dbSizeBytes: stats.size,
    },
    measurements,
  };

  process.stderr.write('\n');
  for (const [name, m] of Object.entries(measurements)) {
    process.stderr.write(
      `${name.padEnd(24)} p50=${String(m.p50Ms).padStart(9)}ms  p95=${String(m.p95Ms).padStart(9)}ms\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
