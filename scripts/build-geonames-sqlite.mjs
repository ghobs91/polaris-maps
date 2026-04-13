#!/usr/bin/env node
/**
 * build-geonames-sqlite.mjs
 *
 * Reads GeoNames cities1000.txt and produces geonames.sqlite with:
 *   - geonames table (main data)
 *   - geonames_fts (FTS5 full-text search)
 *   - geonames_rtree (R-Tree spatial index)
 *
 * Usage: node scripts/build-geonames-sqlite.mjs [path/to/cities1000.txt]
 *
 * If no path is given, looks for cities1000.txt in the current directory.
 * Download from: https://download.geonames.org/export/dump/cities1000.zip
 *
 * Output: geonames.sqlite.gz (~20–25 MB compressed)
 *
 * Prerequisites: npm install better-sqlite3
 */

import { createReadStream, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { createInterface } from 'readline';
import Database from 'better-sqlite3';

const inputPath = process.argv[2] ?? 'cities1000.txt';
const OUTPUT_PATH = resolve('geonames.sqlite');

try {
  statSync(inputPath);
} catch {
  console.error(`File not found: ${inputPath}`);
  console.error('Download from: https://download.geonames.org/export/dump/cities1000.zip');
  process.exit(1);
}

// ── Create database ─────────────────────────────────────────────────────────
const db = new Database(OUTPUT_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE geonames (
    geoname_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    ascii_name TEXT NOT NULL,
    alt_names TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    feature_class TEXT,
    country_code TEXT,
    admin1_code TEXT,
    population INTEGER,
    timezone TEXT
  );

  CREATE VIRTUAL TABLE geonames_fts USING fts5(
    name, ascii_name, alt_names, country_code,
    content='geonames', content_rowid='geoname_id',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE geonames_rtree USING rtree(
    id, min_lat, max_lat, min_lng, max_lng
  );
`);

const insertMain = db.prepare(`
  INSERT INTO geonames
    (geoname_id, name, ascii_name, alt_names, lat, lng, feature_class,
     country_code, admin1_code, population, timezone)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO geonames_fts (rowid, name, ascii_name, alt_names, country_code)
  VALUES (?, ?, ?, ?, ?)
`);

const insertRtree = db.prepare(`
  INSERT INTO geonames_rtree (id, min_lat, max_lat, min_lng, max_lng)
  VALUES (?, ?, ?, ?, ?)
`);

// ── Parse cities1000.txt (tab-separated) ────────────────────────────────────
// GeoNames columns (0-indexed):
//  0  geonameId         1  name            2  asciiname     3  alternatenames
//  4  latitude          5  longitude       6  feature_class 7  feature_code
//  8  country_code      9  cc2             10 admin1_code   11 admin2_code
//  12 admin3_code       13 admin4_code     14 population    15 elevation
//  16 dem               17 timezone        18 modification_date

console.log(`Parsing ${inputPath} …`);

let totalInserted = 0;
const BATCH_SIZE = 5000;
let batch = [];

function flushBatch() {
  if (batch.length === 0) return;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      insertMain.run(
        r.geonameId,
        r.name,
        r.asciiName,
        r.altNames,
        r.lat,
        r.lng,
        r.featureClass,
        r.countryCode,
        r.admin1Code,
        r.population,
        r.timezone,
      );
      insertFts.run(r.geonameId, r.name, r.asciiName, r.altNames, r.countryCode);
      insertRtree.run(r.geonameId, r.lat, r.lat, r.lng, r.lng);
    }
  });
  tx(batch);
  totalInserted += batch.length;
  if (totalInserted % 50_000 === 0) {
    console.log(`  … ${totalInserted.toLocaleString()} rows`);
  }
  batch = [];
}

const rl = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  if (cols.length < 19) continue;

  const geonameId = parseInt(cols[0], 10);
  if (isNaN(geonameId)) continue;

  batch.push({
    geonameId,
    name: cols[1],
    asciiName: cols[2],
    altNames: cols[3] || null,
    lat: parseFloat(cols[4]),
    lng: parseFloat(cols[5]),
    featureClass: cols[6] || null,
    countryCode: cols[8] || null,
    admin1Code: cols[10] || null,
    population: parseInt(cols[14], 10) || 0,
    timezone: cols[17] || null,
  });

  if (batch.length >= BATCH_SIZE) {
    flushBatch();
  }
}

flushBatch();

// Rebuild FTS
console.log('Rebuilding FTS5 index …');
db.exec("INSERT INTO geonames_fts(geonames_fts) VALUES('rebuild')");

db.close();

// Compress
console.log('Compressing …');
execSync(`gzip -9 -k "${OUTPUT_PATH}"`);

const compressedSize = statSync(`${OUTPUT_PATH}.gz`).size;
console.log(`Done — ${totalInserted.toLocaleString()} cities`);
console.log(`  geonames.sqlite.gz: ${(compressedSize / 1024 / 1024).toFixed(1)} MB`);
