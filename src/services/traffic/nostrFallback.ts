/**
 * Nostr relay fallback for traffic probe exchange.
 *
 * Used when the Hyperswarm mesh has < MIN_PEER_THRESHOLD peers for a
 * geohash area. Publishes/subscribes traffic probes as ephemeral Nostr
 * events (kind 20100) over plain WebSockets — runs entirely in Hermes,
 * no extra runtime required.
 *
 * Nostr event structure:
 *   kind: 20100 (ephemeral — relays SHOULD NOT store long-term)
 *   tags: [["g", "<geohash4>"], ["expiration", "<unix_ts + 300>"]]
 *   content: JSON-encoded TrafficProbe
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { getOrCreateKeypair } from '../identity/keypair';
import type { TrafficProbe } from '../../models/traffic';

// ── Constants ───────────────────────────────────────────────────────

/** Custom ephemeral event kind for traffic probes (20000-29999 = ephemeral). */
const TRAFFIC_PROBE_KIND = 20100;

/** Probe TTL in seconds — relays should discard after this. */
const PROBE_EXPIRATION_S = 300; // 5 minutes

/** Maximum relays to connect simultaneously. */
const MAX_RELAYS = 3;

/** Reconnect delay after a relay disconnects. */
const RECONNECT_DELAY_MS = 5_000;

/** WebSocket close code for intentional disconnect. */
const WS_CLOSE_NORMAL = 1000;

// ── Default relay list ──────────────────────────────────────────────

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

// ── Types ───────────────────────────────────────────────────────────

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

type ProbeCallback = (probe: TrafficProbe, eventPubkey: string) => void;

// ── State ───────────────────────────────────────────────────────────

const sockets = new Map<string, WebSocket>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
let subscribedGeohashes = new Set<string>();
let probeCallbacks: ProbeCallback[] = [];
let privateKey: Uint8Array | null = null;
let publicKey: string | null = null;
let disposed = false;
let subscriptionCounter = 0;

// ── Lifecycle ───────────────────────────────────────────────────────

/**
 * Initialize Nostr fallback — loads the local keypair and connects to
 * default relays. Safe to call multiple times.
 */
export async function initNostrFallback(relayUrls?: string[]): Promise<void> {
  disposed = false;

  // Load keypair (same Nostr key used for identity)
  const kp = await getOrCreateKeypair();
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;

  const relays = relayUrls ?? DEFAULT_RELAYS;
  for (const url of relays.slice(0, MAX_RELAYS)) {
    connectRelay(url);
  }
}

/** Disconnect all relay WebSockets and clear state. */
export function disposeNostrFallback(): void {
  disposed = true;
  for (const [url, ws] of sockets) {
    ws.close(WS_CLOSE_NORMAL);
    sockets.delete(url);
  }
  for (const timer of reconnectTimers.values()) {
    clearTimeout(timer);
  }
  reconnectTimers.clear();
  subscribedGeohashes.clear();
  probeCallbacks = [];
}

// ── Relay connection management ─────────────────────────────────────

function connectRelay(url: string): void {
  if (disposed || sockets.has(url)) return;

  const ws = new WebSocket(url);
  sockets.set(url, ws);

  ws.onopen = () => {
    // Re-subscribe to active geohashes on this relay
    for (const gh of subscribedGeohashes) {
      sendSubscription(ws, gh);
    }
  };

  ws.onmessage = (event) => {
    handleRelayMessage(event.data as string);
  };

  ws.onclose = () => {
    sockets.delete(url);
    if (!disposed) {
      const timer = setTimeout(() => {
        reconnectTimers.delete(url);
        connectRelay(url);
      }, RECONNECT_DELAY_MS);
      reconnectTimers.set(url, timer);
    }
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

// ── Subscriptions ───────────────────────────────────────────────────

/**
 * Subscribe to traffic probes for a geohash4 cell across all connected relays.
 */
export function subscribeGeohash(geohash4: string): void {
  subscribedGeohashes.add(geohash4);
  for (const ws of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      sendSubscription(ws, geohash4);
    }
  }
}

/**
 * Unsubscribe from a geohash4 cell.
 */
export function unsubscribeGeohash(geohash4: string): void {
  subscribedGeohashes.delete(geohash4);
  const subId = subscriptionId(geohash4);
  for (const ws of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(['CLOSE', subId]));
    }
  }
}

/** Update the full set of geohash4 subscriptions, adding/removing as needed. */
export function syncSubscriptions(geohashes: Set<string>): void {
  const toAdd = [...geohashes].filter((g) => !subscribedGeohashes.has(g));
  const toRemove = [...subscribedGeohashes].filter((g) => !geohashes.has(g));
  for (const g of toRemove) unsubscribeGeohash(g);
  for (const g of toAdd) subscribeGeohash(g);
}

function subscriptionId(geohash4: string): string {
  return `traffic-${geohash4}`;
}

function sendSubscription(ws: WebSocket, geohash4: string): void {
  // NIP-01 REQ: filter by kind + geohash "g" tag
  const filter = {
    kinds: [TRAFFIC_PROBE_KIND],
    '#g': [geohash4],
    limit: 50,
  };
  ws.send(JSON.stringify(['REQ', subscriptionId(geohash4), filter]));
}

// ── Publishing ──────────────────────────────────────────────────────

/**
 * Publish a traffic probe as an ephemeral Nostr event to all connected relays.
 */
export async function publishProbe(probe: TrafficProbe, geohash4: string): Promise<void> {
  if (!privateKey || !publicKey) return;

  const now = Math.floor(Date.now() / 1000);
  const expiration = String(now + PROBE_EXPIRATION_S);

  const content = JSON.stringify({
    g6: probe.geohash6,
    sid: probe.segmentId,
    spd: probe.speedMph,
    brg: probe.bearing,
    ts: probe.timestamp,
  });

  const tags: string[][] = [
    ['g', geohash4],
    ['expiration', expiration],
  ];

  const event = await createSignedEvent(TRAFFIC_PROBE_KIND, content, tags, now);

  const msg = JSON.stringify(['EVENT', event]);
  for (const ws of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ── Incoming events ─────────────────────────────────────────────────

function handleRelayMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as unknown[];
    if (!Array.isArray(msg)) return;

    // NIP-01: ["EVENT", <subscription_id>, <event>]
    if (msg[0] === 'EVENT' && msg.length >= 3) {
      const event = msg[2] as NostrEvent;
      processIncomingEvent(event);
    }
    // EOSE, OK, NOTICE — ignored for traffic
  } catch {
    // Malformed relay message
  }
}

function processIncomingEvent(event: NostrEvent): void {
  // Ignore own events
  if (event.pubkey === publicKey) return;

  // Check kind
  if (event.kind !== TRAFFIC_PROBE_KIND) return;

  // Verify NIP-01 event ID and Schnorr signature
  if (!verifyEvent(event)) return;

  // Check expiration
  const expirationTag = event.tags.find((t) => t[0] === 'expiration');
  if (expirationTag) {
    const expiry = parseInt(expirationTag[1], 10);
    if (expiry > 0 && expiry < Math.floor(Date.now() / 1000)) return; // Expired
  }

  // Parse probe content
  try {
    const data = JSON.parse(event.content);
    const probe: TrafficProbe = {
      geohash6: data.g6 ?? '',
      segmentId: data.sid ?? '',
      speedMph: data.spd ?? 0,
      bearing: data.brg ?? 0,
      timestamp: data.ts ?? event.created_at,
      probeId: new Uint8Array(0), // No probe ID in Nostr events
    };

    for (const cb of probeCallbacks) {
      cb(probe, event.pubkey);
    }
  } catch {
    // Invalid probe content
  }
}

// ── Event signing (NIP-01) ──────────────────────────────────────────

async function createSignedEvent(
  kind: number,
  content: string,
  tags: string[][],
  createdAt: number,
): Promise<NostrEvent> {
  const serialized = JSON.stringify([0, publicKey, createdAt, kind, tags, content]);
  const idBytes = sha256(new TextEncoder().encode(serialized));
  const id = bytesToHex(idBytes);

  const sig = bytesToHex(schnorr.sign(idBytes, privateKey!));

  return {
    id,
    pubkey: publicKey!,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig,
  };
}

// ── Event handlers ──────────────────────────────────────────────────

export function onProbe(handler: ProbeCallback): () => void {
  probeCallbacks.push(handler);
  return () => {
    probeCallbacks = probeCallbacks.filter((h) => h !== handler);
  };
}

// ── Utilities ───────────────────────────────────────────────────────

export function getConnectedRelayCount(): number {
  let count = 0;
  for (const ws of sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) count++;
  }
  return count;
}

export function getSubscribedGeohashes(): string[] {
  return Array.from(subscribedGeohashes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify NIP-01 event: check that id == sha256([0,pubkey,...]) and that
 * the Schnorr signature over id is valid for event.pubkey.
 */
function verifyEvent(event: NostrEvent): boolean {
  try {
    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const expectedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));
    if (expectedId !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), event.pubkey);
  } catch {
    return false;
  }
}
