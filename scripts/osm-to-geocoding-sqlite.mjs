#!/usr/bin/env node
/**
 * osm-to-geocoding-sqlite.mjs
 *
 * Parse an OSM PBF file and produce a geocoding SQLite database matching the
 * schema in src/services/database/init.ts (plus region_id column).
 *
 * Usage: node scripts/osm-to-geocoding-sqlite.mjs <input.osm.pbf> <region_id>
 * Output: geocoding-data.sqlite in the current directory.
 *
 * Prerequisites: npm install osm-pbf-parser better-sqlite3 through2
 */

import { createReadStream } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';
import createParser from 'osm-pbf-parser';
import through from 'through2';

const [inputPath, regionId] = process.argv.slice(2);
if (!inputPath || !regionId) {
  console.error('Usage: osm-to-geocoding-sqlite.mjs <input.osm.pbf> <region_id>');
  process.exit(1);
}

const OUTPUT_PATH = resolve('geocoding-data.sqlite');

// ── Create SQLite database ──────────────────────────────────────────────────
const db = new Database(OUTPUT_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS geocoding_data (
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

  CREATE VIRTUAL TABLE IF NOT EXISTS geocoding_entries USING fts5(
    text,
    type,
    housenumber,
    street,
    city,
    state,
    postcode,
    country,
    content='geocoding_data'
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO geocoding_data
    (text, type, housenumber, street, city, state, postcode, country, lat, lng, region_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO geocoding_entries (rowid, text, type, housenumber, street, city, state, postcode, country)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalInserted = 0;
const BATCH_SIZE = 5000;
let batch = [];

function flushBatch() {
  if (batch.length === 0) return;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const result = insertStmt.run(
        row.text,
        row.type,
        row.housenumber,
        row.street,
        row.city,
        row.state,
        row.postcode,
        row.country,
        row.lat,
        row.lng,
        row.regionId,
      );
      insertFts.run(
        result.lastInsertRowid,
        row.text,
        row.type,
        row.housenumber,
        row.street,
        row.city,
        row.state,
        row.postcode,
        row.country,
      );
    }
  });
  tx(batch);
  totalInserted += batch.length;
  if (totalInserted % 50_000 === 0) {
    console.log(`  … ${totalInserted.toLocaleString()} rows inserted`);
  }
  batch = [];
}

function processItem(item) {
  const tags = item.tags || {};
  let lat, lng;

  if (item.lat != null && item.lon != null) {
    lat = item.lat;
    lng = item.lon;
  } else if (item.type === 'way' && item.refs?.length > 0) {
    // Ways don't have lat/lon directly in osm-pbf-parser; skip unless
    // a centroid is computed upstream. In practice we rely on node-level data.
    return;
  } else {
    return;
  }

  const housenumber = tags['addr:housenumber'] || null;
  const street = tags['addr:street'] || null;
  const city = tags['addr:city'] || null;
  const state = tags['addr:state'] || null;
  const postcode = tags['addr:postcode'] || null;
  const country = tags['addr:country'] || null;
  const name = tags['name'] || null;

  if (housenumber && street) {
    // Address entry
    const text = [housenumber, street, city].filter(Boolean).join(', ');
    batch.push({
      text,
      type: 'address',
      housenumber,
      street,
      city,
      state,
      postcode,
      country,
      lat,
      lng: lng,
      regionId,
    });
  } else if (name && !housenumber) {
    // Named place entry
    batch.push({
      text: name,
      type: 'place',
      housenumber: null,
      street: null,
      city,
      state,
      postcode,
      country,
      lat,
      lng: lng,
      regionId,
    });
  }

  if (batch.length >= BATCH_SIZE) {
    flushBatch();
  }
}

// ── Stream-parse the PBF ────────────────────────────────────────────────────
console.log(`Parsing ${inputPath} for region ${regionId} …`);

const parser = createParser();

await new Promise((resolve, reject) => {
  createReadStream(inputPath)
    .pipe(parser)
    .pipe(
      through.obj(function (items, _enc, cb) {
        for (const item of items) {
          processItem(item);
        }
        cb();
      }),
    )
    .on('finish', resolve)
    .on('error', reject);
});

// Flush remaining
flushBatch();

// Rebuild FTS index
console.log('Rebuilding FTS5 index …');
db.exec("INSERT INTO geocoding_entries(geocoding_entries) VALUES('rebuild')");

db.close();
console.log(`Done — ${totalInserted.toLocaleString()} rows written to ${OUTPUT_PATH}`);
