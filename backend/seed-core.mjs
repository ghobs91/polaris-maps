/**
 * Runtime-agnostic region-pack seeding core.
 *
 * The seeding rules are shared by two hosts that must never disagree about them:
 *
 *   - the Bare worklet on iOS/Android (`backend/hyperdrive.mjs`), which answers
 *     React Native RPC over `BareKit.IPC`;
 *   - the desktop relay (`relay/src/seed-node.mjs`), a plain Node process.
 *
 * So this file owns everything that is neither IPC nor runtime-specific —
 * Corestore lifetime, canonical read-only replicas, discovery joins, status —
 * and takes `fs`, `path`, and the swarm factory as arguments. Same shape and
 * same reason as `pmtiles.mjs` (documented as running "in two places — the Bare
 * worklet with `bare-fs` injected; Node, for the parity test, with `node:fs`
 * injected") and `shard-answer.mjs`.
 *
 * Why this matters more here than anywhere else: the canonical-key and
 * read-only rules are the ones that already produced two distribution bugs
 * (per-device keys making every seeder invisible to every other; `drive_key`
 * always null on a fresh install). Two copies of those rules means two chances
 * to reintroduce them, on two runtimes, with no test that compares them.
 *
 * Deliberately *not* here: file transforms (gunzip/tar/PMTiles), the shard-query
 * protocol, download orchestration, and any IPC — those either belong to a
 * single host or are already pure modules of their own.
 */

import Hyperdrive from 'hyperdrive';
import Corestore from 'corestore';
import b4a from 'b4a';
import { sha256 } from './node_modules/@noble/hashes/sha256.js';

/**
 * @param {object} options
 * @param {object} options.fs        `bare-fs` or `node:fs`
 * @param {object} options.path      `bare-path` or `node:path`
 * @param {() => any} options.createSwarm returns a fresh Hyperswarm instance
 * @param {(conn: any) => void} [options.onConnection] called after a new peer
 *   connection has had every seeded store attached (the worklet uses this to
 *   bind its shard-query protocol; the relay uses it for connection accounting)
 */
export function createSeedCore({ fs, path, createSwarm, onConnection }) {
  let swarm = null;
  /** regionId → { drive, discovery, store, readOnly, contentHash, bytes, root } */
  const seededDrives = new Map();
  // Corestores are file-locked. Reuse one per storage path and close it on
  // release, otherwise a second open of the same path fails to lock
  // ("File descriptor could not be locked").
  const stores = new Map(); // storePath → Corestore

  function getStore(storePath) {
    let store = stores.get(storePath);
    if (!store) {
      store = new Corestore(storePath);
      stores.set(storePath, store);
    }
    return store;
  }

  async function closeStore(storePath) {
    const store = stores.get(storePath);
    if (!store) return;
    stores.delete(storePath);
    try {
      await store.close();
    } catch {
      /* already closed */
    }
  }

  function corestorePath(rootDir, regionId) {
    return path.join(rootDir, regionId);
  }

  function ensureSwarm() {
    if (swarm) return swarm;
    swarm = createSwarm();
    swarm.on('connection', (conn) => {
      for (const { store } of seededDrives.values()) store.replicate(conn);
      if (onConnection) onConnection(conn);
    });
    return swarm;
  }

  /** The live swarm, or null before anything has been seeded. */
  function currentSwarm() {
    return swarm;
  }

  /**
   * Seed a region pack.
   *
   * With `key`: open a **read-only replica** of the canonical drive, replicate
   * it, and join the canonical discovery key — every seeder of that pack then
   * advertises the same topic. Without `key`: author the writable drive (the
   * publisher path), which returns the key a manifest is built from.
   *
   * Throws with a caller-facing message on failure; hosts translate that into
   * their own error shape.
   */
  async function seed({ regionId, filesDir, key, corestoreRoot }) {
    const readOnly = Boolean(key);
    const storePath = corestorePath(corestoreRoot, regionId);

    if (!readOnly && !fs.existsSync(filesDir)) {
      throw new Error(`Pack directory not found: ${filesDir}`);
    }

    const existing = seededDrives.get(regionId);
    if (existing) {
      const existingKey = b4a.toString(existing.drive.key, 'hex');
      if (!key || existingKey === key) {
        return {
          key: existingKey,
          discoveryKey: b4a.toString(existing.drive.discoveryKey, 'hex'),
          readOnly: existing.readOnly,
          contentHash: existing.contentHash || undefined,
          bytes: existing.bytes,
        };
      }
      await existing.discovery.destroy();
      await closeStore(corestorePath(existing.root, regionId));
      seededDrives.delete(regionId);
    }

    const store = getStore(storePath);
    let drive;
    let contentHash = null;
    let bytes = 0;

    if (readOnly) {
      drive = new Hyperdrive(store, b4a.from(key, 'hex'));
      await drive.ready();
    } else {
      drive = new Hyperdrive(store);
      await drive.ready();

      const files = collectFiles(fs, path, filesDir, filesDir);
      for (const { rel, abs } of files) {
        await drive.put(rel, fs.readFileSync(abs));
      }
      ({ contentHash, bytes } = computePackIndex(fs, files));
    }

    const sw = ensureSwarm();
    const discovery = sw.join(drive.discoveryKey);
    await discovery.flushed();

    seededDrives.set(regionId, {
      drive,
      discovery,
      store,
      readOnly,
      contentHash,
      bytes,
      root: corestoreRoot,
    });

    return {
      key: b4a.toString(drive.key, 'hex'),
      discoveryKey: b4a.toString(drive.discoveryKey, 'hex'),
      readOnly,
      contentHash: contentHash || undefined,
      bytes,
    };
  }

  async function unseed({ regionId }) {
    const entry = seededDrives.get(regionId);
    if (entry) {
      await entry.discovery.destroy();
      await closeStore(corestorePath(entry.root, regionId));
      seededDrives.delete(regionId);
    }
    return { success: true };
  }

  function status() {
    const drives = [];
    for (const [regionId, { drive, readOnly, bytes }] of seededDrives) {
      drives.push({
        regionId,
        key: b4a.toString(drive.key, 'hex'),
        discoveryKey: b4a.toString(drive.discoveryKey, 'hex'),
        peers: drive.core.peers ? drive.core.peers.length : 0,
        readOnly,
        bytes,
      });
    }
    return { drives, swarmConnections: swarm ? swarm.connections.size : 0 };
  }

  /** Seeded entries, for hosts that answer queries out of a drive they hold. */
  function drives() {
    return seededDrives;
  }

  async function destroy() {
    if (swarm) {
      try {
        await swarm.destroy();
      } catch {
        /* already gone */
      }
      swarm = null;
    }
    for (const storePath of [...stores.keys()]) {
      await closeStore(storePath);
    }
    seededDrives.clear();
  }

  return {
    seed,
    unseed,
    status,
    drives,
    ensureSwarm,
    currentSwarm,
    getStore,
    closeStore,
    destroy,
  };
}

/** Recursively collect files as `/relative` paths under `baseDir`. */
export function collectFiles(fs, path, baseDir, currentDir, result = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) collectFiles(fs, path, baseDir, abs, result);
    else result.push({ rel: '/' + path.relative(baseDir, abs), abs });
  }
  return result;
}

/**
 * Deterministic pack index hash + total size. MUST match
 * `computePackContentHash` in src/services/regions/regionManifest.ts
 * (sorted `path\0size` lines, SHA-256 hex).
 */
export function computePackIndex(fs, files) {
  const entries = files
    .map(({ rel, abs }) => ({ path: rel, size: fs.statSync(abs).size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const contentHash = b4a.toString(
    sha256(b4a.from(entries.map((e) => `${e.path}\u0000${e.size}`).join('\n'))),
    'hex',
  );
  const bytes = entries.reduce((n, e) => n + e.size, 0);
  return { contentHash, bytes };
}
