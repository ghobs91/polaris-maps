#!/usr/bin/env node
/**
 * verify-shard-answer.mjs — contract check for the worklet's shard responder.
 *
 * `backend/shard-answer.mjs` runs in the Bare worklet and builds the answers
 * peers return; `src/services/poi/verifiableShardIndex.ts` verifies them on
 * device. This script runs the worklet module over fixed fixtures and prints the
 * results as JSON so a Jest test can compare them with the app implementation.
 *
 * Usage: node scripts/verify-shard-answer.mjs
 */

import {
  answerQuery,
  buildRoot,
  canonicalEntry,
  hashLeaf,
  matchesQuery,
  parseJsonl,
  shardPathFor,
  shardTopic,
} from '../backend/shard-answer.mjs';

const SHARD = [
  {
    osmType: 'node',
    osmId: 1,
    lat: 40.748,
    lng: -73.985,
    primaryKey: 'amenity',
    subtype: 'cafe',
    name: 'Blue Bottle',
    tags: { amenity: 'cafe', name: 'Blue Bottle', 'addr:street': 'Bleecker St' },
  },
  {
    osmType: 'node',
    osmId: 2,
    lat: 40.749,
    lng: -73.986,
    primaryKey: 'amenity',
    subtype: 'restaurant',
    name: 'Sorbillo',
    tags: { amenity: 'restaurant', name: 'Sorbillo' },
  },
  {
    osmType: 'way',
    osmId: 3,
    lat: 40.79,
    lng: -73.91,
    primaryKey: 'amenity',
    subtype: 'fuel',
    name: 'Shell',
    tags: { amenity: 'fuel', name: 'Shell', 'fuel:diesel': 'yes' },
  },
];

const QUERY = { version: 1, shardId: 'geohash:u0u1', merkleRoot: buildRoot(SHARD), limit: 100 };

const output = {
  root: buildRoot(SHARD),
  canonical: canonicalEntry(SHARD[0]),
  leaf: hashLeaf(SHARD[0]),
  shardPath: shardPathFor('geohash:u0u1'),
  shardTopic: Buffer.from(shardTopic('geohash:u0u1')).toString('hex'),
  jsonlRoundTrip: parseJsonl(SHARD.map((entry) => JSON.stringify(entry)).join('\n')),
  matches: {
    any: SHARD.filter((entry) => matchesQuery(entry, QUERY)).length,
    fuel: SHARD.filter((entry) =>
      matchesQuery(entry, { ...QUERY, keys: [{ key: 'amenity', value: 'fuel' }] }),
    ).length,
    diesel: SHARD.filter((entry) =>
      matchesQuery(entry, { ...QUERY, tags: [['fuel:diesel', 'yes']] }),
    ).length,
  },
  full: answerQuery(SHARD, QUERY),
  filtered: answerQuery(SHARD, { ...QUERY, keys: [{ key: 'amenity', value: 'fuel' }] }),
  truncated: answerQuery(SHARD, { ...QUERY, limit: 1 }),
};

process.stdout.write(JSON.stringify(output));
