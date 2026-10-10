/**
 * Bare worklet entry point: Hyperdrive-based region-pack transport.
 *
 * Runs inside react-native-bare-kit's Bare runtime — NOT Hermes, NOT Node.js.
 * Communication with React Native is via BareKit.IPC + bare-rpc. This replaces
 * the never-wired `NodeChannel` nodejs-mobile sidecar.
 *
 * Responsibilities:
 *   1. Host a Corestore + Hyperdrive per region pack under the app documents dir
 *   2. Author a canonical writable drive, or join a read-only replica by key
 *   3. Download a pack from peers by canonical key, reporting byte progress
 *   4. Report seeded-drive status and release drives on request
 */

/* global Bare, BareKit */

import './process-shim.mjs';
import RPC from 'bare-rpc';
import Hyperswarm from 'hyperswarm';
import Hyperdrive from 'hyperdrive';
import Corestore from 'corestore';
import b4a from 'b4a';
import fs from 'bare-fs';
import path from 'bare-path';
import goodbye from 'graceful-goodbye';
import { ungzip } from 'pako';
import { sha256 } from './node_modules/@noble/hashes/sha256.js';

// ── RPC command IDs (shared with src/services/sync/hdRpcCommands.ts) ─

const CMD_HD_SEED = 0; // RN → worklet
const CMD_HD_DOWNLOAD = 1; // RN → worklet
const CMD_HD_STATUS = 2; // RN → worklet
const CMD_HD_UNSEED = 3; // RN → worklet
const CMD_HD_GUNZIP = 4; // RN → worklet: gunzip a file in place
const CMD_HD_EXTRACT_TAR = 5; // RN → worklet: extract a (gzipped) tar archive
const CMD_HD_DOWNLOAD_PROGRESS = 20; // worklet → RN

// ── State ───────────────────────────────────────────────────────────

let swarm = null;
const seededDrives = new Map(); // regionId → { drive, discovery, store, readOnly, contentHash, bytes, root }
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

const { IPC } = BareKit;
const rpc = new RPC(IPC, (req) => {
  handleRequest(req);
});

function reply(req, obj) {
  req.reply(b4a.from(JSON.stringify(obj)));
}

function corestorePath(rootDir, regionId) {
  return path.join(rootDir, regionId);
}

function ensureSwarm() {
  if (swarm) return swarm;
  swarm = new Hyperswarm();
  swarm.on('connection', (conn) => {
    for (const { store } of seededDrives.values()) store.replicate(conn);
  });
  goodbye(() => swarm.destroy());
  return swarm;
}

async function handleRequest(req) {
  try {
    switch (req.command) {
      case CMD_HD_SEED:
        await handleSeed(req);
        break;
      case CMD_HD_DOWNLOAD:
        await handleDownload(req);
        break;
      case CMD_HD_STATUS:
        handleStatus(req);
        break;
      case CMD_HD_UNSEED:
        await handleUnseed(req);
        break;
      case CMD_HD_GUNZIP:
        handleGunzip(req);
        break;
      case CMD_HD_EXTRACT_TAR:
        handleExtractTar(req);
        break;
      default:
        reply(req, { error: `unknown command ${req.command}` });
    }
  } catch (err) {
    console.error('[hyperdrive] RPC error:', err);
    reply(req, { error: err && err.message ? err.message : String(err) });
  }
}

// ── Seed (author / read-only) ───────────────────────────────────────

async function handleSeed(req) {
  const { regionId, filesDir, key, corestoreRoot } = JSON.parse(b4a.toString(req.data));
  const readOnly = Boolean(key);
  const storePath = corestorePath(corestoreRoot, regionId);

  if (!readOnly && !fs.existsSync(filesDir)) {
    return reply(req, { error: `Pack directory not found: ${filesDir}` });
  }

  const existing = seededDrives.get(regionId);
  if (existing) {
    const existingKey = b4a.toString(existing.drive.key, 'hex');
    if (!key || existingKey === key) {
      return reply(req, {
        key: existingKey,
        discoveryKey: b4a.toString(existing.drive.discoveryKey, 'hex'),
        readOnly: existing.readOnly,
        contentHash: existing.contentHash || undefined,
        bytes: existing.bytes,
      });
    }
    await existing.discovery.destroy();
    await closeStore(storePath);
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

    const files = collectFiles(filesDir, filesDir);
    for (const { rel, abs } of files) {
      await drive.put(rel, fs.readFileSync(abs));
    }
    ({ contentHash, bytes } = computePackIndex(files));
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

  reply(req, {
    key: b4a.toString(drive.key, 'hex'),
    discoveryKey: b4a.toString(drive.discoveryKey, 'hex'),
    readOnly,
    contentHash: contentHash || undefined,
    bytes,
  });
}

// ── Download ────────────────────────────────────────────────────────

async function handleDownload(req) {
  const { driveKey, destDir, corestoreRoot } = JSON.parse(b4a.toString(req.data));
  const storePath = corestorePath(corestoreRoot, '_dl_' + driveKey.slice(0, 16));
  const store = getStore(storePath);
  const drive = new Hyperdrive(store, b4a.from(driveKey, 'hex'));
  await drive.ready();

  const sw = ensureSwarm();
  sw.on('connection', (conn) => store.replicate(conn));

  const discovery = sw.join(drive.discoveryKey);
  await discovery.flushed();

  const peerFound = await Promise.race([
    new Promise((resolve) => {
      if (drive.core.peers.length > 0) return resolve(true);
      sw.once('connection', () => resolve(true));
    }),
    new Promise((resolve) => setTimeout(() => resolve(false), 30_000)),
  ]);

  if (!peerFound) {
    await discovery.destroy();
    await closeStore(storePath);
    return reply(req, { error: 'No peers found for this drive' });
  }

  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  let totalBytes = 0;

  for await (const entry of drive.list('/')) {
    const filePath = path.resolve(destDir, entry.key);
    if (!filePath.startsWith(resolvedDest + path.sep)) continue; // traversal guard
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const content = await drive.get(entry.key);
    if (content) {
      fs.writeFileSync(filePath, content);
      totalBytes += content.length;
      const progress = rpc.request(CMD_HD_DOWNLOAD_PROGRESS);
      progress.send(
        b4a.from(JSON.stringify({ file: entry.key, bytes: content.length, totalBytes })),
      );
    }
  }

  await discovery.destroy();
  await closeStore(storePath);
  reply(req, { totalBytes });
}

// ── Status / unseed ─────────────────────────────────────────────────

function handleStatus(req) {
  const drives = [];
  for (const [regionId, { drive }] of seededDrives) {
    drives.push({
      regionId,
      key: b4a.toString(drive.key, 'hex'),
      discoveryKey: b4a.toString(drive.discoveryKey, 'hex'),
      peers: drive.core.peers ? drive.core.peers.length : 0,
    });
  }
  reply(req, { drives, swarmConnections: swarm ? swarm.connections.size : 0 });
}

async function handleUnseed(req) {
  const { regionId } = JSON.parse(b4a.toString(req.data));
  const entry = seededDrives.get(regionId);
  if (entry) {
    await entry.discovery.destroy();
    await closeStore(corestorePath(entry.root, regionId));
    seededDrives.delete(regionId);
  }
  reply(req, { success: true });
}

// ── File transforms (region-pack assembly) ──────────────────────────

/** Gunzip a file in place: read `inputPath`, write to `outputPath`. */
function handleGunzip(req) {
  const { inputPath, outputPath } = JSON.parse(b4a.toString(req.data));
  const out = ungzip(fs.readFileSync(inputPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, out);
  reply(req, { outputPath });
}

/**
 * Extract a (optionally gzipped) USTAR archive, ported from the old Node
 * sidecar. Guards against path traversal and decompression bombs.
 */
function handleExtractTar(req) {
  const { srcPath, destDir } = JSON.parse(b4a.toString(req.data));
  const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

  if (!fs.existsSync(srcPath)) {
    return reply(req, { error: `Source file not found: ${srcPath}` });
  }

  let buf = fs.readFileSync(srcPath);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = ungzip(buf);
    if (buf.length > MAX_UNCOMPRESSED_BYTES) {
      return reply(req, { error: 'Archive exceeds the uncompressed size limit' });
    }
  }
  if (buf.length < 512) {
    return reply(req, { error: 'Archive is too small to be a valid tar' });
  }

  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDestDir = path.resolve(destDir);

  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive

    const nameRaw = b4a.toString(header.subarray(0, 100)).replace(/\0/g, '');
    const sizeOctal = b4a.toString(header.subarray(124, 136)).replace(/\0/g, '').trim();
    const typeFlag = header[156];
    const size = parseInt(sizeOctal, 8) || 0;
    offset += 512;

    if (!nameRaw) break;

    const fullPath = path.resolve(resolvedDestDir, nameRaw);
    if (!fullPath.startsWith(resolvedDestDir + path.sep) && fullPath !== resolvedDestDir) {
      offset += Math.ceil(size / 512) * 512; // skip path-traversal entries
      continue;
    }

    if (typeFlag === 53 || nameRaw.endsWith('/')) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, buf.subarray(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512;
  }

  reply(req, { success: true });
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Recursively collect files as `/relative` paths under `baseDir`. */
function collectFiles(baseDir, currentDir, result = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) collectFiles(baseDir, abs, result);
    else result.push({ rel: '/' + path.relative(baseDir, abs), abs });
  }
  return result;
}

/**
 * Deterministic pack index hash + total size. MUST match
 * `computePackContentHash` in src/services/regions/regionManifest.ts
 * (sorted `path\0size` lines, SHA-256 hex).
 */
function computePackIndex(files) {
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
