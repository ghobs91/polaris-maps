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
