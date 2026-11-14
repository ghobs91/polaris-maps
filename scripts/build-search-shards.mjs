#!/usr/bin/env node
/**
 * build-search-shards.mjs
 *
 * Splits a region pack's `search.sqlite` into content-addressed POI shards and
 * emits the descriptors the app verifies against
 * (src/services/regions/shardManifest.ts).
 *
 * Each shard is one geohash-4 cell (~39 km x 20 km) of POIs, written as JSONL,
 * plus:
 *
 *   sha256      — of the exact payload bytes, so any mirror/peer can serve it
 *   merkleRoot  — binary Merkle root over the shard's entries, using the same
 *                 leaf/node encoding as src/services/poi/verifiableShardIndex.ts
 *
 * The Merkle scheme MUST stay byte-identical to the app implementation, or
 * verification of peer answers fails; `__tests__/unit/shardBuilderParity.test.ts`
 * recomputes these roots with the app's code.
 *
 * Usage:
 *   node scripts/build-search-shards.mjs <search.sqlite> <out_dir>
 *
 * Output:
 *   <out_dir>/shards/<cell>.jsonl
 *   <out_dir>/shards.json          (descriptors; sign with the publisher key)
 *
 * Node >= 22 (uses node:sqlite). No npm dependencies.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const SHARD_PRECISION = 4;

/** Encode a coordinate as a geohash of the given precision. */
export function geohashEncode(lat, lng, precision = SHARD_PRECISION) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let value = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        value = (value << 1) | 1;
        lngMin = mid;
      } else {
        value <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = (value << 1) | 1;
        latMin = mid;
      } else {
        value <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += GEOHASH_BASE32[value];
      bit = 0;
      value = 0;
    }
  }
  return hash;
}

/** Bounding box of a geohash cell (used for shard selection on the client). */
export function geohashBounds(hash) {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const char of hash) {
    const index = GEOHASH_BASE32.indexOf(char);
    if (index < 0) throw new Error(`invalid geohash: ${hash}`);
    for (let mask = 16; mask > 0; mask >>= 1) {
      const bitSet = (index & mask) !== 0;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (bitSet) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitSet) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { south: latMin, north: latMax, west: lngMin, east: lngMax };
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Canonical entry serialisation. Field order and numeric precision are fixed,
 * and tag keys are sorted — identical to `canonicalShardEntry` in
 * src/services/poi/verifiableShardIndex.ts.
 */
export function canonicalShardEntry(entry) {
  const tagKeys = Object.keys(entry.tags ?? {}).sort();
  const tags = tagKeys
    .map((k) => `${JSON.stringify(k)}:${JSON.stringify(entry.tags[k])}`)
    .join(',');
  return [
    entry.osmType,
    entry.osmId,
    entry.lat.toFixed(7),
    entry.lng.toFixed(7),
    entry.primaryKey,
    entry.subtype,
    entry.name,
    `{${tags}}`,
  ].join('\u0000');
}

export function hashLeaf(entry) {
  return sha256Hex(Buffer.concat([Buffer.from([0x00]), Buffer.from(canonicalShardEntry(entry))]));
}

function hashNodes(left, right) {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([0x01]), left, right]))
    .digest('hex');
}

export function shardEntryKey(entry) {
  return `${entry.osmType}/${entry.osmId}`;
}

/** Merkle root over a shard's entries (odd node promoted, never duplicated). */
export function buildShardRoot(entries) {
  if (entries.length === 0) return sha256Hex(Buffer.from([0x00]));
  const sorted = [...entries].sort((a, b) => {
    const ka = shardEntryKey(a);
    const kb = shardEntryKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  let level = sorted.map((entry) => Buffer.from(hashLeaf(entry), 'hex'));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      next.push(right ? Buffer.from(hashNodes(left, right), 'hex') : left);
    }
    level = next;
  }
  return level[0].toString('hex');
}

function readPois(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT osm_type, osm_id, lat, lng, primary_key, subtype, name, tags_json
           FROM osm_pois`,
      )
      .all();
    return rows.map((row) => ({
      osmType: row.osm_type,
      osmId: row.osm_id,
      lat: row.lat,
      lng: row.lng,
      primaryKey: row.primary_key,
      subtype: row.subtype,
      name: row.name,
      tags: JSON.parse(row.tags_json ?? '{}'),
    }));
  } finally {
    db.close();
  }
}

export function buildShards(entries, shardDir, { precision = SHARD_PRECISION } = {}) {
  mkdirSync(shardDir, { recursive: true });

  const cells = new Map();
  for (const entry of entries) {
    const cell = geohashEncode(entry.lat, entry.lng, precision);
    const list = cells.get(cell);
    if (list) list.push(entry);
    else cells.set(cell, [entry]);
  }

  const descriptors = [];
  for (const cell of [...cells.keys()].sort()) {
    const shardEntries = cells
      .get(cell)
      .sort((a, b) => (shardEntryKey(a) < shardEntryKey(b) ? -1 : 1));
    const payload = Buffer.from(
      shardEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'utf8',
    );
    const path = `shards/${cell}.jsonl`;
    writeFileSync(join(shardDir, `${cell}.jsonl`), payload);

    const bounds = geohashBounds(cell);
    descriptors.push({
      shardId: `geohash:${cell}`,
      path,
      bytes: payload.length,
      sha256: sha256Hex(payload),
      merkleRoot: buildShardRoot(shardEntries),
      south: bounds.south,
      west: bounds.west,
      north: bounds.north,
      east: bounds.east,
      poiCount: shardEntries.length,
    });
  }

  return descriptors;
}

function main() {
  const [dbPath, outDir] = process.argv.slice(2);
  if (!dbPath || !outDir) {
    process.stderr.write('Usage: build-search-shards.mjs <search.sqlite> <out_dir>\n');
    return 1;
  }

  const entries = readPois(dbPath);
  const shardDir = join(outDir, 'shards');
  const descriptors = buildShards(entries, shardDir);
  writeFileSync(join(outDir, 'shards.json'), JSON.stringify({ shards: descriptors }, null, 2));

  const shardBytes = readdirSync(shardDir).reduce(
    (sum, file) => sum + statSync(join(shardDir, file)).size,
    0,
  );
  process.stdout.write(
    `search shards: ${descriptors.length} shards, ${entries.length} POIs, ` +
      `${(shardBytes / 1024 / 1024).toFixed(1)} MB payload\n`,
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('build-search-shards.mjs')) {
  process.exit(main());
}
