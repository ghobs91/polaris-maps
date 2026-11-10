/**
 * Bare worklet entry point: Hyperswarm-based traffic probe exchange.
 *
 * Runs inside react-native-bare-kit's Bare runtime — NOT Hermes, NOT Node.js.
 * Communication with React Native is via BareKit.IPC + bare-rpc.
 *
 * Responsibilities:
 *   1. Join Hyperswarm topics per geohash4 cell for traffic probe exchange
 *   2. Exchange raw protobuf-encoded TrafficProbes with connected peers
 *   3. Aggregate incoming probes into per-segment speed estimates
 *   4. Report aggregated traffic + peer counts back to RN via RPC
 */

/* global Bare, BareKit */

import './bootstrap-guard.mjs';
import './process-shim.mjs';
import RPC from 'bare-rpc';
import Hyperswarm from 'hyperswarm';
// Import the CJS build directly (pure JS, no node:crypto). The package's
// exports map routes bare-pack's ESM resolution to esm/cryptoNode.js which
// imports node builtins that don't exist in the Bare runtime.
import { sha256 } from './node_modules/@noble/hashes/sha256.js';
import b4a from 'b4a';
import goodbye from 'graceful-goodbye';

// ── RPC command IDs ─────────────────────────────────────────────────

const CMD_JOIN_TOPIC = 0;
const CMD_LEAVE_TOPIC = 1;
const CMD_PUBLISH_PROBE = 2;
const CMD_GET_STATUS = 3;
const CMD_REQUEST_CONDITIONS = 4; // RN → worklet: broadcast condition request
const CMD_SEND_CONDITION_RESPONSE = 5; // RN → worklet: reply to a peer
const CMD_REQUEST_TILE = 6; // RN → worklet: broadcast tile request
const CMD_SEND_TILE_RESPONSE = 7; // RN → worklet: reply to a peer with a tile
const CMD_PUBLISH_INCIDENT = 8; // RN → worklet: broadcast an incident envelope
const CMD_INCOMING_PROBE = 10;
const CMD_PEER_COUNT = 11;
const CMD_AGGREGATED_UPDATE = 12;
const CMD_INCOMING_CONDITION_REQUEST = 13; // worklet → RN
const CMD_INCOMING_CONDITION_RESPONSE = 14; // worklet → RN
const CMD_INCOMING_TILE_REQUEST = 15; // worklet → RN
const CMD_INCOMING_TILE_RESPONSE = 16; // worklet → RN
const CMD_INCOMING_INCIDENT = 17; // worklet → RN: a peer broadcast an incident
const CMD_SUSPEND = 20;
const CMD_RESUME = 21;
/** RN → worklet: apply the current network profile ("metered"/"unmetered"). */
const CMD_SET_NETWORK_PROFILE = 22;

// ── Protomux channel name for traffic probes ────────────────────────

const PROTOCOL_NAME = 'polaris-traffic-v1';
const TOPIC_PREFIX = 'polaris-traffic-v1-';

// ── Constants ───────────────────────────────────────────────────────

const WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window
const MAX_SPEED_MPH = 125;
const MAX_TIMESTAMP_DRIFT_S = 300; // ±5 minutes
const AGGREGATE_BROADCAST_INTERVAL_MS = 3_000;

/**
 * Hard bounds for a mobile device. Hyperswarm connects to every peer it
 * discovers on a topic, so a dense cell (a city launch, an event, a viral
 * post) would otherwise turn into an O(n) connection set and an O(n) fanout
 * for every probe. These caps keep the mesh linear regardless of density.
 */
const MAX_PEER_CONNECTIONS = 64;
const MAX_PEERS_PER_TOPIC = 24;
/** Split the global budget so one direction cannot starve the other. */
const MAX_CLIENT_CONNECTIONS = 32;
const MAX_SERVER_CONNECTIONS = 32;
/** Rotating subsets: each message reaches at most this many peers. */
const PROBE_FANOUT = 12;
const INCIDENT_FANOUT = 16;
const CONDITION_REQUEST_FANOUT = 8;
/**
 * Tile responses are ~50 KB each, so a tile request goes to fewer peers than a
 * condition query. Rotating the subset means coverage builds over requests
 * instead of duplicating one tile across the whole cell.
 */
const TILE_REQUEST_FANOUT = 4;
/** Coalesce peer-count UI updates when many connections churn at once. */
const PEER_COUNT_BROADCAST_MIN_INTERVAL_MS = 250;

// ── State ───────────────────────────────────────────────────────────

let swarm = null;
const joinedTopics = new Map(); // geohash4 → { discovery, connections: Set }
const peerProtocols = new Map(); // connection → { info, connId }
const connById = new Map(); // connId → connection
const topicCellByHex = new Map(); // hex(topic) → geohash4
let nextConnId = 1;
/** True on cellular/hotspot links: stop announcing ourselves as a server. */
let metered = false;
/** Round-robin cursor so rotating fanout reaches every peer over time. */
let fanoutCursor = 0;
/** Connections refused by the density cap (surfaced in status/diagnostics). */
let prunedConnections = 0;
let peerCountBroadcastTimer = null;
let lastPeerCountBroadcastAt = 0;

// Probe aggregation (per-segment rolling window)
const segmentProbes = new Map(); // segmentId → [{ speedMph, timestamp }]
const aggregated = new Map(); // segmentId → { segmentId, avgSpeedMph, sampleCount, congestionLevel, lastUpdated }

// ── IPC / RPC setup ─────────────────────────────────────────────────

const { IPC } = BareKit;
const rpc = new RPC(IPC, (req) => {
  handleRequest(req);
});

function handleRequest(req) {
  try {
    switch (req.command) {
      case CMD_JOIN_TOPIC: {
        const geohash4 = b4a.toString(req.data);
        joinGeohashTopic(geohash4);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_LEAVE_TOPIC: {
        const geohash4 = b4a.toString(req.data);
        leaveGeohashTopic(geohash4);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_PUBLISH_PROBE: {
        const probeBytes = req.data;
        broadcastProbe(probeBytes);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_REQUEST_CONDITIONS: {
        broadcastConditionRequest(req.data);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_SEND_CONDITION_RESPONSE: {
        handleSendConditionResponse(req.data);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_REQUEST_TILE: {
        broadcastTileRequest(req.data);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_SEND_TILE_RESPONSE: {
        handleSendTileResponse(req.data);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_PUBLISH_INCIDENT: {
        broadcastIncident(req.data);
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_GET_STATUS: {
        const status = JSON.stringify({
          peerCount: swarm ? swarm.connections.size : 0,
          topicCount: joinedTopics.size,
          topics: Array.from(joinedTopics.keys()),
          segmentCount: aggregated.size,
          metered,
          prunedConnections,
        });
        req.reply(b4a.from(status));
        break;
      }
      case CMD_SET_NETWORK_PROFILE: {
        applyNetworkProfile(b4a.toString(req.data) === 'metered');
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_SUSPEND: {
        // Hyperswarm.suspend() is async; an unhandled rejection here aborts the
        // whole worklet (Bare kills the process on unhandled rejections).
        if (swarm) swarm.suspend().catch(() => {});
        req.reply(b4a.from('ok'));
        break;
      }
      case CMD_RESUME: {
        if (swarm) swarm.resume().catch(() => {});
        req.reply(b4a.from('ok'));
        break;
      }
      default:
        req.reply(b4a.from('unknown'));
    }
  } catch (err) {
    console.error('[traffic-swarm] RPC error:', err);
    req.reply(b4a.from('error'));
  }
}

// ── Hyperswarm management ───────────────────────────────────────────

function ensureSwarm() {
  if (swarm) return swarm;

  swarm = new Hyperswarm({
    maxPeers: MAX_PEER_CONNECTIONS,
    maxClientConnections: MAX_CLIENT_CONNECTIONS,
    maxServerConnections: MAX_SERVER_CONNECTIONS,
  });

  swarm.on('connection', (conn, info) => {
    setupPeerProtocol(conn, info);
  });

  goodbye(() => swarm.destroy());
  return swarm;
}

function topicHash(geohash4) {
  return sha256(b4a.from(TOPIC_PREFIX + geohash4));
}

function joinGeohashTopic(geohash4) {
  if (joinedTopics.has(geohash4)) return;

  const sw = ensureSwarm();
  const topic = topicHash(geohash4);
  // On metered links we stay client-only: we still consume peers' data but
  // never accept inbound connections or upload from cellular.
  const discovery = sw.join(topic, { server: !metered, client: true });
  const topicHex = b4a.toString(topic, 'hex');
  topicCellByHex.set(topicHex, geohash4);

  joinedTopics.set(geohash4, { discovery, connections: new Set(), topicHex });

  // Report peer count change once discovery flushes
  discovery
    .flushed()
    .then(() => {
      broadcastPeerCount();
    })
    .catch(() => {});
}

function leaveGeohashTopic(geohash4) {
  const entry = joinedTopics.get(geohash4);
  if (!entry) return;

  entry.discovery.destroy().catch(() => {});
  joinedTopics.delete(geohash4);
  if (entry.topicHex) topicCellByHex.delete(entry.topicHex);
  broadcastPeerCount();
}

/**
 * Re-apply the server/client role to every joined topic.
 *
 * Hyperswarm's `server` flag is fixed at join time, so changing it means
 * leaving and re-joining the topic. Existing outbound connections stay up.
 */
function applyNetworkProfile(nextMetered) {
  if (metered === nextMetered) return;
  metered = nextMetered;

  const cells = Array.from(joinedTopics.keys());
  for (const cell of cells) {
    const entry = joinedTopics.get(cell);
    if (entry) entry.discovery.destroy().catch(() => {});
    joinedTopics.delete(cell);
  }
  topicCellByHex.clear();
  for (const cell of cells) joinGeohashTopic(cell);

  // Do not keep serving inbound streams after switching to metered.
  if (metered) {
    for (const [conn, peer] of Array.from(peerProtocols.entries())) {
      if (peer.info && peer.info.client === false) {
        try {
          conn.destroy();
        } catch {
          // Already closed.
        }
      }
    }
  }

  broadcastPeerCount();
}

/** geohash4 cell for a connection, from the topic(s) the connection is on. */
function topicCellForConnection(info) {
  const topics = info && Array.isArray(info.topics) ? info.topics : [];
  for (const topic of topics) {
    const cell = topicCellByHex.get(b4a.toString(topic, 'hex'));
    if (cell) return cell;
  }
  return null;
}

/**
 * Send an envelope to a bounded, rotating subset of peers.
 *
 * Full fanout is O(peers) per message and O(peers²) network-wide per interval;
 * at city density that is the mesh's worst case. Rotating the start offset
 * means every peer still sees every kind of message over time.
 */
function sendToPeerSubset(bytes, limit) {
  const conns = Array.from(peerProtocols.keys());
  if (conns.length === 0) return;

  if (conns.length <= limit) {
    for (const conn of conns) {
      try {
        conn.write(bytes);
      } catch {
        // Connection may have closed
      }
    }
    return;
  }

  const start = fanoutCursor % conns.length;
  for (let i = 0; i < limit; i++) {
    const conn = conns[(start + i) % conns.length];
    try {
      conn.write(bytes);
    } catch {
      // Connection may have closed
    }
  }
  fanoutCursor = (start + limit) % conns.length;
}

// ── Per-connection protocol ─────────────────────────────────────────

function setupPeerProtocol(conn, info) {
  const cell = topicCellForConnection(info);
  const topicEntry = cell ? joinedTopics.get(cell) : null;

  // Density cap. Hyperswarm reconnects pruned peers, which is preferable to
  // an unbounded connection set: each rejection is a cheap handshake, while
  // each retained peer costs a stream, timers, and per-message writes.
  if (
    peerProtocols.size >= MAX_PEER_CONNECTIONS ||
    (topicEntry && topicEntry.connections.size >= MAX_PEERS_PER_TOPIC)
  ) {
    prunedConnections++;
    try {
      conn.destroy();
    } catch {
      // Already closed.
    }
    return;
  }

  const connId = nextConnId++;
  connById.set(connId, conn);
  if (topicEntry) topicEntry.connections.add(conn);

  conn.on('data', (data) => {
    handleConnectionData(data, conn, connId);
  });

  const detach = () => {
    peerProtocols.delete(conn);
    connById.delete(connId);
    if (topicEntry) topicEntry.connections.delete(conn);
  };

  conn.on('close', () => {
    detach();
    broadcastPeerCount();
  });

  conn.on('error', () => {
    detach();
  });

  peerProtocols.set(conn, { info, connId });
  broadcastPeerCount();
}

/**
 * Dispatch an inbound peer message by envelope type:
 *   - `t: 'cr'`  → condition request: forward to RN, RN answers via RPC
 *   - `t: 'cs'`  → condition response: forward to RN
 *   - otherwise  → legacy traffic probe (v1 format)
 */
function handleConnectionData(data, conn, connId) {
  let msg;
  try {
    msg = JSON.parse(b4a.toString(data));
  } catch {
    return; // Malformed — skip
  }

  if (msg && msg.t === 'cr') {
    notifyConditionRequest(msg, connId);
    return;
  }
  if (msg && msg.t === 'cs') {
    notifyConditionResponse(msg);
    return;
  }
  if (msg && msg.t === 'tr') {
    notifyTileRequest(msg, connId);
    return;
  }
  if (msg && msg.t === 'ts') {
    notifyTileResponse(msg);
    return;
  }

  // Incident envelopes must be handled before the legacy probe decoder so an
  // incident never produces a traffic probe.
  if (msg && msg.t === 'i') {
    notifyIncident(msg);
    return;
  }

  handleIncomingProbe(data, conn);
}

// ── Probe broadcasting ──────────────────────────────────────────────

function broadcastProbe(probeBytes) {
  // Bounded, rotating sample of peers — never the whole cell.
  sendToPeerSubset(probeBytes, PROBE_FANOUT);

  // Also ingest locally
  handleIncomingProbe(probeBytes, null);
}

// ── Condition request/response relaying ─────────────────────────────

/** Broadcast a condition request (raw JSON from RN) to a bounded peer sample. */
function broadcastConditionRequest(reqBytes) {
  sendToPeerSubset(reqBytes, CONDITION_REQUEST_FANOUT);
}

/** Request a tile from a small, rotating peer sample (responses are large). */
function broadcastTileRequest(reqBytes) {
  sendToPeerSubset(reqBytes, TILE_REQUEST_FANOUT);
}

/**
 * Broadcast a signed incident envelope (raw JSON from RN) to every peer.
 * The worklet does not decode or validate incidents — signature verification
 * happens in React Native so peers cannot smuggle data past the check.
 */
function broadcastIncident(incidentBytes) {
  sendToPeerSubset(incidentBytes, INCIDENT_FANOUT);
}

/**
 * RN → worklet: send a condition response back to one peer.
 * Data is `{ connId, requestId, entries }`.
 */
function handleSendConditionResponse(data) {
  let parsed;
  try {
    parsed = JSON.parse(b4a.toString(data));
  } catch {
    return;
  }
  const conn = connById.get(parsed.connId);
  if (!conn) return;

  const msg = {
    t: 'cs',
    id: parsed.requestId,
    e: parsed.entries,
  };
  try {
    conn.write(b4a.from(JSON.stringify(msg)));
  } catch {
    // Connection may have closed
  }
}

/**
 * RN → worklet: send a tile response back to one peer.
 * Data is `{ connId, requestId, tile: { z, x, y, b64 } }`.
 */
function handleSendTileResponse(data) {
  let parsed;
  try {
    parsed = JSON.parse(b4a.toString(data));
  } catch {
    return;
  }
  const conn = connById.get(parsed.connId);
  if (!conn) return;

  const msg = {
    t: 'ts',
    id: parsed.requestId,
    tl: parsed.tile,
  };
  try {
    conn.write(b4a.from(JSON.stringify(msg)));
  } catch {
    // Connection may have closed
  }
}

// ── Probe ingestion & aggregation ───────────────────────────────────

function handleIncomingProbe(data, sourceConn) {
  try {
    const probe = decodeProbe(data);
    if (!probe) return;

    // Validate
    if (probe.speedMph < 0 || probe.speedMph > MAX_SPEED_MPH) return;
    if (probe.bearing < 0 || probe.bearing >= 360) return;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(probe.timestamp - now) > MAX_TIMESTAMP_DRIFT_S) return;
    if (!probe.segmentId) return;

    // Store
    let entries = segmentProbes.get(probe.segmentId);
    if (!entries) {
      entries = [];
      segmentProbes.set(probe.segmentId, entries);
    }
    entries.push({ speedMph: probe.speedMph, timestamp: probe.timestamp });

    // Evict old
    const cutoff = now - WINDOW_MS / 1000;
    const fresh = entries.filter((e) => e.timestamp > cutoff);
    segmentProbes.set(probe.segmentId, fresh);

    if (fresh.length === 0) {
      aggregated.delete(probe.segmentId);
      return;
    }

    // Compute
    const totalSpeed = fresh.reduce((sum, e) => sum + e.speedMph, 0);
    const avgSpeed = totalSpeed / fresh.length;
    const congestionLevel = classifyCongestion(avgSpeed);

    aggregated.set(probe.segmentId, {
      segmentId: probe.segmentId,
      avgSpeedMph: Math.round(avgSpeed * 10) / 10,
      sampleCount: fresh.length,
      congestionLevel,
      lastUpdated: now,
    });

    // Forward to RN
    notifyProbeReceived(probe);
  } catch {
    // Malformed probe — skip
  }
}

function classifyCongestion(avgSpeedMph) {
  if (avgSpeedMph < 3) return 'stopped';
  if (avgSpeedMph < 15) return 'congested';
  if (avgSpeedMph < 30) return 'slow';
  return 'free_flow';
}

// ── Probe encoding/decoding (compact JSON → migrate to protobuf) ────

function decodeProbe(data) {
  try {
    const json = JSON.parse(b4a.toString(data));
    return {
      geohash6: json.g6 || json.geohash6 || '',
      segmentId: json.sid || json.segment_id || json.segmentId || '',
      speedMph: json.spd || json.speed_mph || json.speedMph || 0,
      bearing: json.brg || json.bearing || 0,
      timestamp: json.ts || json.timestamp || 0,
      probeId: json.pid || json.probe_id || '',
    };
  } catch {
    return null;
  }
}

function encodeProbe(probe) {
  return b4a.from(
    JSON.stringify({
      g6: probe.geohash6,
      sid: probe.segmentId,
      spd: probe.speedMph,
      brg: probe.bearing,
      ts: probe.timestamp,
      pid: probe.probeId,
    }),
  );
}

// ── Notifications to RN ─────────────────────────────────────────────

function notifyProbeReceived(probe) {
  try {
    const req = rpc.request(CMD_INCOMING_PROBE);
    req.send(b4a.from(JSON.stringify(probe)));
  } catch {
    // RPC may not be ready
  }
}

function notifyConditionRequest(msg, connId) {
  try {
    const req = rpc.request(CMD_INCOMING_CONDITION_REQUEST);
    req.send(
      b4a.from(
        JSON.stringify({
          connId,
          id: msg.id || '',
          cells: msg.c || [],
          bucket: { dayOfWeek: msg.d ?? 0, halfHour: msg.h ?? 0 },
          maxAgeSec: msg.a ?? 900,
        }),
      ),
    );
  } catch {
    // RPC may not be ready
  }
}

function notifyConditionResponse(msg) {
  try {
    const req = rpc.request(CMD_INCOMING_CONDITION_RESPONSE);
    req.send(
      b4a.from(
        JSON.stringify({
          id: msg.id || '',
          entries: msg.e || [],
        }),
      ),
    );
  } catch {
    // RPC may not be ready
  }
}

function notifyTileRequest(msg, connId) {
  try {
    const req = rpc.request(CMD_INCOMING_TILE_REQUEST);
    req.send(
      b4a.from(
        JSON.stringify({
          connId,
          id: msg.id || '',
          z: msg.z ?? 0,
          x: msg.x ?? 0,
          y: msg.y ?? 0,
        }),
      ),
    );
  } catch {
    // RPC may not be ready
  }
}

function notifyTileResponse(msg) {
  try {
    const req = rpc.request(CMD_INCOMING_TILE_RESPONSE);
    req.send(
      b4a.from(
        JSON.stringify({
          id: msg.id || '',
          tile: msg.tl || null,
        }),
      ),
    );
  } catch {
    // RPC may not be ready
  }
}

function notifyIncident(msg) {
  try {
    const req = rpc.request(CMD_INCOMING_INCIDENT);
    req.send(b4a.from(JSON.stringify(msg)));
  } catch {
    // RPC may not be ready
  }
}

function broadcastPeerCount() {
  if (peerCountBroadcastTimer) return;
  const elapsed = Date.now() - lastPeerCountBroadcastAt;
  const wait = PEER_COUNT_BROADCAST_MIN_INTERVAL_MS - elapsed;
  if (wait <= 0) {
    sendPeerCount();
    return;
  }
  peerCountBroadcastTimer = setTimeout(() => {
    peerCountBroadcastTimer = null;
    sendPeerCount();
  }, wait);
}

function sendPeerCount() {
  lastPeerCountBroadcastAt = Date.now();
  try {
    const count = swarm ? swarm.connections.size : 0;
    const req = rpc.request(CMD_PEER_COUNT);
    req.send(b4a.from(String(count)));
  } catch {
    // RPC may not be ready
  }
}

function broadcastAggregatedState() {
  if (aggregated.size === 0) return;
  try {
    const states = Array.from(aggregated.values());
    const req = rpc.request(CMD_AGGREGATED_UPDATE);
    req.send(b4a.from(JSON.stringify(states)));
  } catch {
    // RPC may not be ready
  }
}

// Periodically send aggregated state to RN
setInterval(broadcastAggregatedState, AGGREGATE_BROADCAST_INTERVAL_MS);

// Export for bare-pack
export {
  CMD_JOIN_TOPIC,
  CMD_LEAVE_TOPIC,
  CMD_PUBLISH_PROBE,
  CMD_GET_STATUS,
  CMD_REQUEST_CONDITIONS,
  CMD_SEND_CONDITION_RESPONSE,
  CMD_REQUEST_TILE,
  CMD_SEND_TILE_RESPONSE,
  CMD_PUBLISH_INCIDENT,
  CMD_INCOMING_PROBE,
  CMD_PEER_COUNT,
  CMD_AGGREGATED_UPDATE,
  CMD_INCOMING_CONDITION_REQUEST,
  CMD_INCOMING_CONDITION_RESPONSE,
  CMD_INCOMING_TILE_REQUEST,
  CMD_INCOMING_TILE_RESPONSE,
  CMD_INCOMING_INCIDENT,
  CMD_SUSPEND,
  CMD_RESUME,
  CMD_SET_NETWORK_PROFILE,
  encodeProbe,
  decodeProbe,
};
