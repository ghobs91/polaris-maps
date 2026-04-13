// nodejs-mobile sidecar entry point for Waku v2
// This file runs in the nodejs-mobile runtime, not React Native.
// Communication with RN is via the bridge (channel messaging).

const { channel } = require('bridge');

let subscriptions = new Set();
let peerCount = 0;

// Placeholder: In production, this imports @waku/sdk
// and initializes a LightNode with filter + lightpush protocols.
let wakuNode = null;

async function initWaku() {
  // TODO: Initialize Waku light node
  // const { createLightNode, waitForRemotePeer } = require('@waku/sdk');
  // wakuNode = await createLightNode({ defaultBootstrap: true });
  // await wakuNode.start();
  // await waitForRemotePeer(wakuNode);
  console.log('[Waku sidecar] initialized');
}

channel.addListener('message', async (msg) => {
  try {
    const command = JSON.parse(msg);
    switch (command.type) {
      case 'subscribe':
        await handleSubscribe(command);
        break;
      case 'unsubscribe':
        await handleUnsubscribe(command);
        break;
      case 'publish':
        await handlePublish(command);
        break;
      case 'extract-tar':
        await handleExtractTar(command);
        break;
      case 'gunzip': {
        const { inputPath, outputPath, requestId } = command;
        // Security: validate outputPath stays under the app home directory
        const resolvedOut = path.resolve(outputPath);
        const homeDir = require('os').homedir();
        if (!resolvedOut.startsWith(homeDir + path.sep) && resolvedOut !== homeDir) {
          channel.send(
            JSON.stringify({
              action: 'gunzip_error',
              error: 'Output path outside app directory',
              requestId,
            }),
          );
          break;
        }
        const gunzipStream = zlib.createGunzip();
        const input = fs.createReadStream(inputPath);
        const output = fs.createWriteStream(resolvedOut);
        input.pipe(gunzipStream).pipe(output);
        output.on('finish', () =>
          channel.send(
            JSON.stringify({ action: 'gunzip_done', outputPath: resolvedOut, requestId }),
          ),
        );
        output.on('error', (err) =>
          channel.send(JSON.stringify({ action: 'gunzip_error', error: err.message, requestId })),
        );
        break;
      }
      case 'status':
        handleStatus(command);
        break;
      // Hyperdrive commands
      case 'hd-seed':
        await handleHdSeed(command);
        break;
      case 'hd-download':
        await handleHdDownload(command);
        break;
      case 'hd-status':
        handleHdStatus(command);
        break;
      case 'hd-unseed':
        await handleHdUnseed(command);
        break;
      default:
        sendError(command.requestId, `Unknown command: ${command.type}`);
    }
  } catch (err) {
    console.error('[Waku sidecar] error:', err);
  }
});

async function handleSubscribe(command) {
  const { topic, requestId } = command;
  subscriptions.add(topic);

  // TODO: wakuNode.filter.subscribe(decoder, callback)
  // For now, acknowledge subscription
  sendResponse(requestId, { type: 'response', success: true });
}

async function handleUnsubscribe(command) {
  const { topic, requestId } = command;
  subscriptions.delete(topic);

  // TODO: wakuNode.filter.unsubscribe(decoder)
  sendResponse(requestId, { type: 'response', success: true });
}

async function handlePublish(command) {
  const { topic, payload, requestId } = command;

  // TODO: wakuNode.lightPush.send(encoder, { payload })
  sendResponse(requestId, { type: 'response', success: true });
}

function handleStatus(command) {
  sendResponse(command.requestId, {
    type: 'status',
    peerCount,
    subscriptionCount: subscriptions.size,
    topics: Array.from(subscriptions),
  });
}

function sendResponse(requestId, data) {
  channel.send(JSON.stringify({ ...data, requestId }));
}

function sendError(requestId, error) {
  channel.send(JSON.stringify({ type: 'error', error, requestId }));
}

// --- tar extraction (Node.js built-ins only) ---

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

async function handleExtractTar(command) {
  const { srcPath, destDir, requestId } = command;

  /** Maximum uncompressed archive size: 2 GB (decompression bomb guard). */
  const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

  try {
    if (!fs.existsSync(srcPath)) {
      return sendError(requestId, `Source file not found: ${srcPath}`);
    }
    fs.mkdirSync(destDir, { recursive: true });

    let buf = fs.readFileSync(srcPath);

    // Detect gzip (magic bytes 1f 8b) and decompress with size guard.
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    }

    // Validate tar magic: POSIX ustar archives have "ustar" at offset 257.
    // Plain (pre-POSIX) archives have no magic but are still valid tars — we
    // allow both and only require the buffer to be large enough for one header.
    if (buf.length < 512) {
      return sendError(requestId, 'Archive is too small to be a valid tar');
    }

    const resolvedDestDir = path.resolve(destDir);

    let offset = 0;
    while (offset + 512 <= buf.length) {
      const header = buf.slice(offset, offset + 512);
      // Two zero blocks mark end of archive
      if (header.every((b) => b === 0)) break;

      const nameRaw = header.slice(0, 100).toString('utf8').replace(/\0/g, '');
      const sizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim();
      const typeFlag = header[156];
      const size = parseInt(sizeOctal, 8) || 0;
      offset += 512;

      if (!nameRaw) break;

      // Security: resolve the full path and verify it stays within destDir.
      // This prevents path traversal attacks (e.g. entries like ../../evil).
      const fullPath = path.resolve(resolvedDestDir, nameRaw);
      if (!fullPath.startsWith(resolvedDestDir + path.sep) && fullPath !== resolvedDestDir) {
        // Skip entries that attempt to escape the destination directory
        offset += Math.ceil(size / 512) * 512;
        continue;
      }

      // Directory (typeflag '5' = 53)
      if (typeFlag === 53 || nameRaw.endsWith('/')) {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        // Regular file
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, buf.slice(offset, offset + size));
      }

      // Advance past data, padded to 512-byte boundary
      offset += Math.ceil(size / 512) * 512;
    }

    sendResponse(requestId, { type: 'response', success: true });
  } catch (err) {
    sendError(requestId, err.message || String(err));
  }
}

// Simulate incoming message relay (production: filter callback)
function onIncomingMessage(topic, payload) {
  channel.send(
    JSON.stringify({
      type: 'message',
      topic,
      payload: Array.from(payload),
    }),
  );
}

// --- Hyperdrive: P2P region data seeding & downloading ---

const Hyperswarm = require('hyperswarm');
const Hyperdrive = require('hyperdrive');
const Corestore = require('corestore');

let swarm = null;
const seededDrives = new Map(); // regionId -> { drive, discovery }

function getCorestorePath() {
  // Use app documents dir; nodejs-mobile has access to the same FS
  return path.join(require('os').homedir(), '.polaris-corestore');
}

function ensureSwarm() {
  if (swarm) return swarm;
  swarm = new Hyperswarm();
  swarm.on('connection', (conn, info) => {
    // Replicate all corestores over this connection
    for (const { drive } of seededDrives.values()) {
      drive.corestore.replicate(conn);
    }
  });
  return swarm;
}

/**
 * Seed a region: import local files into a Hyperdrive, join the swarm.
 * Returns the drive's discovery key (hex) for other peers to find it.
 *
 * Command: { type: 'hd-seed', regionId, filesDir, requestId }
 * filesDir contains: tiles.pmtiles, routing/ (dir), geocoding.db
 */
async function handleHdSeed(command) {
  const { regionId, filesDir, requestId } = command;
  try {
    if (seededDrives.has(regionId)) {
      const existing = seededDrives.get(regionId);
      return sendResponse(requestId, {
        type: 'hd-seed-result',
        discoveryKey: existing.drive.discoveryKey.toString('hex'),
        key: existing.drive.key.toString('hex'),
      });
    }

    const storePath = path.join(getCorestorePath(), regionId);
    const store = new Corestore(storePath);
    const drive = new Hyperdrive(store);
    await drive.ready();

    // Import region files into the drive
    const filesToImport = [];
    collectFiles(filesDir, filesDir, filesToImport);

    for (const { relativePath, absolutePath } of filesToImport) {
      const content = fs.readFileSync(absolutePath);
      await drive.put(relativePath, content);
    }

    // Join swarm to make this drive discoverable
    const sw = ensureSwarm();
    const discovery = sw.join(drive.discoveryKey);
    await discovery.flushed();

    seededDrives.set(regionId, { drive, discovery, store });

    console.log(
      `[Hyperdrive] Seeding ${regionId} — key: ${drive.key.toString('hex').slice(0, 16)}…`,
    );

    sendResponse(requestId, {
      type: 'hd-seed-result',
      discoveryKey: drive.discoveryKey.toString('hex'),
      key: drive.key.toString('hex'),
    });
  } catch (err) {
    sendError(requestId, err.message || String(err));
  }
}

/**
 * Download a region from a known drive key (hex string).
 * Writes files to destDir.
 *
 * Command: { type: 'hd-download', driveKey, destDir, requestId }
 */
async function handleHdDownload(command) {
  const { driveKey, destDir, requestId } = command;
  try {
    const storePath = path.join(getCorestorePath(), '_dl_' + driveKey.slice(0, 16));
    const store = new Corestore(storePath);
    const drive = new Hyperdrive(store, Buffer.from(driveKey, 'hex'));
    await drive.ready();

    // Join swarm to find peers that seed this drive
    const sw = ensureSwarm();

    sw.on('connection', (conn) => {
      drive.corestore.replicate(conn);
    });

    const discovery = sw.join(drive.discoveryKey);
    await discovery.flushed();

    // Wait for initial peer connection (timeout 30s)
    const peerFound = await Promise.race([
      new Promise((resolve) => {
        if (drive.core.peers.length > 0) return resolve(true);
        sw.once('connection', () => resolve(true));
      }),
      new Promise((resolve) => setTimeout(() => resolve(false), 30_000)),
    ]);

    if (!peerFound) {
      await discovery.destroy();
      await store.close();
      return sendError(requestId, 'No peers found for this drive');
    }

    // Download all files from the drive
    fs.mkdirSync(destDir, { recursive: true });
    const resolvedDest = path.resolve(destDir);
    let totalBytes = 0;

    for await (const entry of drive.list('/')) {
      const filePath = path.resolve(destDir, entry.key);
      if (!filePath.startsWith(resolvedDest + path.sep)) {
        continue; // skip path-traversal attempts
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      const content = await drive.get(entry.key);
      if (content) {
        fs.writeFileSync(filePath, content);
        totalBytes += content.length;

        // Report progress
        channel.send(
          JSON.stringify({
            type: 'hd-download-progress',
            requestId,
            file: entry.key,
            bytes: content.length,
            totalBytes,
          }),
        );
      }
    }

    // Clean up download-side store
    await discovery.destroy();
    await store.close();

    sendResponse(requestId, {
      type: 'hd-download-result',
      totalBytes,
    });
  } catch (err) {
    sendError(requestId, err.message || String(err));
  }
}

/**
 * Stop seeding a region and release resources.
 *
 * Command: { type: 'hd-unseed', regionId, requestId }
 */
async function handleHdUnseed(command) {
  const { regionId, requestId } = command;
  try {
    const entry = seededDrives.get(regionId);
    if (entry) {
      await entry.discovery.destroy();
      await entry.store.close();
      seededDrives.delete(regionId);
    }
    sendResponse(requestId, { type: 'response', success: true });
  } catch (err) {
    sendError(requestId, err.message || String(err));
  }
}

/**
 * Return status for all seeded drives.
 *
 * Command: { type: 'hd-status', requestId }
 */
function handleHdStatus(command) {
  const drives = [];
  for (const [regionId, { drive }] of seededDrives) {
    drives.push({
      regionId,
      key: drive.key.toString('hex'),
      discoveryKey: drive.discoveryKey.toString('hex'),
      peers: drive.core.peers ? drive.core.peers.length : 0,
    });
  }
  sendResponse(command.requestId, {
    type: 'hd-status-result',
    drives,
    swarmConnections: swarm ? swarm.connections.size : 0,
  });
}

/** Recursively collect files from a directory. */
function collectFiles(baseDir, currentDir, result) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(baseDir, abs, result);
    } else {
      const rel = '/' + path.relative(baseDir, abs);
      result.push({ relativePath: rel, absolutePath: abs });
    }
  }
}

initWaku().catch(console.error);
