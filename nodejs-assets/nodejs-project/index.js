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
      case 'status':
        handleStatus(command);
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
  try {
    if (!fs.existsSync(srcPath)) {
      return sendError(requestId, `Source file not found: ${srcPath}`);
    }
    fs.mkdirSync(destDir, { recursive: true });

    let buf = fs.readFileSync(srcPath);

    // Detect gzip (magic bytes 1f 8b)
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      buf = zlib.gunzipSync(buf);
    }

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

      const fullPath = path.join(destDir, nameRaw);
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

initWaku().catch(console.error);
