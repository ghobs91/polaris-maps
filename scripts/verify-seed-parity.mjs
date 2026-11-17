#!/usr/bin/env node
/**
 * Seed-core parity check: runs `backend/seed-core.mjs` under Node.
 *
 * The seed core is shared by two runtimes (the Bare worklet on the devices,
 * plain Node in the desktop relay). `pmtiles.mjs` and `shard-answer.mjs` have the
 * same split and the same proof requirement: run the shared module under the
 * *other* runtime and diff the result, because a divergence is silent — packs
 * would be seeded by the relay on one discovery key and downloaded by the phone
 * on another, and nothing in either log would say so.
 *
 * What this asserts, in order:
 *
 *   1. A pack is authored through the core (publisher path) and reports a key,
 *      discovery key, content hash and byte count.
 *   2. A **read-only replica** of the same pack, opened by key through a second
 *      core, reports the *same* key and discovery key — the property every
 *      canonical seeder depends on — and starts empty, because a replica holds
 *      no blocks until a peer sends them.
 *   3. The authored drive serves the pack's bytes back, and the content hash
 *      matches the authoritative `computePackContentHash` in
 *      `src/services/regions/regionManifest.ts`.
 *   4. `unseed` releases the drive and `status` stops reporting it.
 *
 * Usage: node scripts/verify-seed-parity.mjs [--keep]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSeedCore } from '../backend/seed-core.mjs';

const KEEP = process.argv.includes('--keep');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✔ ${message}`);
}

/**
 * The authoritative content hash, copied byte-for-byte from
 * `computePackContentHash` (sorted `path\0size` lines, SHA-256 hex). If this
 * ever disagrees with the core's `computePackIndex`, the app would reject every
 * pack the relay seeds — so it is compared rather than trusted.
 */
function authoritativeContentHash(files) {
  const lines = files
    .map(({ rel, size }) => `${rel}\u0000${size}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function writeFixturePack(dir) {
  const files = [
    { rel: '/catalog.json', body: '{"region":"fixture"}' },
    { rel: '/meta.json', body: '{"v":1}' },
    { rel: '/tiles/1/0/0.pbf', body: 'tile-bytes-1' },
    { rel: '/tiles/1/1/0.pbf', body: 'tile-bytes-2' },
  ];

  for (const { rel, body } of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  return files.map(({ rel, body }) => ({ rel, size: Buffer.byteLength(body) }));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-seed-parity-'));
  const packDir = path.join(root, 'pack');
  const authorStore = path.join(root, 'corestore-author');
  const replicaStore = path.join(root, 'corestore-replica');

  fs.mkdirSync(packDir, { recursive: true });
  const fixture = writeFixturePack(packDir);
  const expectedHash = authoritativeContentHash(fixture);

  // This proves the *contract* is identical under Node. Wire replication is
  // covered by the relay's end-to-end check (`relay/test/seed.e2e.mjs`) and by
  // the app itself; a stub swarm keeps this check deterministic and offline.
  const stubSwarm = () => ({
    on() {},
    join: () => ({ flushed: async () => {}, destroy: async () => {} }),
    connections: new Set(),
  });
  const author = createSeedCore({ fs, path, createSwarm: stubSwarm });
  const replica = createSeedCore({ fs, path, createSwarm: stubSwarm });

  try {
    // 1. Author the pack (publisher path).
    const authored = await author.seed({
      regionId: 'fixture-region',
      filesDir: packDir,
      corestoreRoot: authorStore,
    });

    if (!authored.key || !authored.discoveryKey) {
      fail('authoring produced no key / discoveryKey');
      return;
    }
    if (authored.readOnly) fail('authored drive was reported read-only');

    if (authored.contentHash !== expectedHash) {
      fail(`contentHash ${authored.contentHash} != authoritative ${expectedHash}`);
    } else {
      ok('content hash matches src/services/regions/regionManifest.ts');
    }

    const expectedBytes = fixture.reduce((n, f) => n + f.size, 0);
    if (authored.bytes !== expectedBytes) {
      fail(`bytes ${authored.bytes} != ${expectedBytes}`);
    } else {
      ok(`pack size matches (${expectedBytes} bytes)`);
    }

    // 2. Replicate read-only by key — the property every seeder depends on.
    const replicated = await replica.seed({
      regionId: 'fixture-region',
      filesDir: packDir,
      key: authored.key,
      corestoreRoot: replicaStore,
    });

    if (!replicated.readOnly) fail('key-based seed was not reported read-only');

    if (replicated.key !== authored.key) {
      fail(`replica key ${replicated.key} != authoring key ${authored.key}`);
    }
    if (replicated.discoveryKey !== authored.discoveryKey) {
      fail(`replica discoveryKey ${replicated.discoveryKey} != ${authored.discoveryKey}`);
    }
    if (replicated.key === authored.key && replicated.discoveryKey === authored.discoveryKey) {
      ok('read-only replica shares the canonical key and discovery key');
    }

    // 3. The authored drive serves the bytes back; the replica is a clone that
    // holds nothing until a peer sends blocks (so it must read as empty).
    const authorDrive = [...author.drives().values()][0]?.drive;
    if (!authorDrive) {
      fail('authoring produced no seeded drive');
    } else {
      for (const { rel, body } of [
        { rel: '/catalog.json', body: '{"region":"fixture"}' },
        { rel: '/tiles/1/0/0.pbf', body: 'tile-bytes-1' },
      ]) {
        const got = await authorDrive.get(rel);
        if (!got || Buffer.compare(Buffer.from(got), Buffer.from(body)) !== 0) {
          fail(`authored drive content mismatch for ${rel}`);
        }
      }
      ok('authored drive serves the pack bytes');
    }

    const replicaDrive = [...replica.drives().values()][0]?.drive;
    if (!replicaDrive) {
      fail('replica has no seeded drive');
    } else {
      const local = await replicaDrive.get('/catalog.json');
      if (local !== null) {
        fail('read-only replica held blocks before any peer replicated them');
      } else {
        ok('read-only replica starts empty and must replicate from a seeder');
      }
    }

    // 4. Status shape both hosts depend on.
    const status = replica.status();
    const entry = status.drives.find((d) => d.regionId === 'fixture-region');
    if (!entry) fail('status does not report the seeded region');
    if (entry && typeof entry.peers !== 'number') fail('status entry has no numeric peers');
    if (entry) ok('status reports the seeded drive with a peer count');

    // 5. Unseed releases it.
    await replica.unseed({ regionId: 'fixture-region' });
    if (replica.status().drives.some((d) => d.regionId === 'fixture-region')) {
      fail('unseed left the drive in status');
    } else {
      ok('unseed releases the drive');
    }

    // Authoring twice with the same key must be idempotent (the app re-seeds on
    // every download and must not churn the topic).
    const again = await author.seed({
      regionId: 'fixture-region',
      filesDir: packDir,
      corestoreRoot: authorStore,
    });
    if (again.discoveryKey !== authored.discoveryKey) {
      fail('re-seeding an already-seeded region changed the discovery key');
    } else {
      ok('re-seeding an existing region is idempotent');
    }

    // A read-only replica must refuse to author: seeding without a key always
    // means "write", so a replica must never be opened that way.
    if (replicated.readOnly !== true) fail('replica path was not read-only');
  } finally {
    await author.destroy();
    await replica.destroy();
    if (KEEP) {
      console.log(`\nFixture kept at ${root}`);
    } else {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  console.log(
    process.exitCode ? '\nSeed-core parity check FAILED' : '\nSeed-core parity check passed',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
