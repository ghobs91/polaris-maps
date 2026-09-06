/**
 * IPC bridge from React Native (Hermes) to the Bare worklet running
 * the Hyperswarm traffic mesh.
 *
 * Uses react-native-bare-kit's Worklet + bare-rpc for communication.
 * Replaces the previous Waku bridge (wakuBridge.ts).
 */

// react-native-bare-kit provides the Worklet class.
// The bundle is generated via `npx bare-pack`.
// Lazily resolved so the module can load even before the native rebuild.

let WorkletClass:
  | (new () => {
      start(entry: string, bundle: string, args: string[]): void;
      terminate(): void;
      IPC: unknown;
    })
  | null = null;

let RPCClass:
  | (new (
      ipc: unknown,
      onrequest: (req: RpcRequest) => void,
    ) => { request(cmd: number): { send(data: Uint8Array): void } })
  | null = null;

function resolveNativeDeps(): boolean {
  if (WorkletClass && RPCClass) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WorkletClass = (require('react-native-bare-kit') as { Worklet: typeof WorkletClass }).Worklet;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RPCClass = require('bare-rpc') as typeof RPCClass;
    return true;
  } catch (e) {
    console.warn('[HyperswarmBridge] Native BareKit not available — skipping P2P traffic mesh.', e);
    return false;
  }
}

interface RpcRequest {
  command: number;
  data: Uint8Array;
  send: (d: Uint8Array) => void;
}

import * as FileSystem from 'expo-file-system/legacy';
import {
  CMD_JOIN_TOPIC,
  CMD_LEAVE_TOPIC,
  CMD_PUBLISH_PROBE,
  CMD_GET_STATUS,
  CMD_REQUEST_CONDITIONS,
  CMD_SEND_CONDITION_RESPONSE,
  CMD_REQUEST_TILE,
  CMD_SEND_TILE_RESPONSE,
  CMD_INCOMING_PROBE,
  CMD_PEER_COUNT,
  CMD_AGGREGATED_UPDATE,
  CMD_INCOMING_CONDITION_REQUEST,
  CMD_INCOMING_CONDITION_RESPONSE,
  CMD_INCOMING_TILE_REQUEST,
  CMD_INCOMING_TILE_RESPONSE,
  CMD_SUSPEND,
  CMD_RESUME,
} from './rpcCommands';
import type { AggregatedTrafficState, TrafficProbe } from '../../models/traffic';
import type { WireConditionEntry } from '../../models/trafficHistory';
import type { WireTilePayload } from '../../models/trafficTile';

// The bundle is produced by `npx bare-pack --target ios --target android --linked`
let trafficBundle: string | null = null;
try {
  // Dynamic require — bare-pack writes this after bundling the backend
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  trafficBundle = require('../../../backend/traffic-swarm.bundle.mjs');
} catch {
  // Bundle not yet built — worklet won't start
}

type ProbeHandler = (probe: TrafficProbe) => void;
type PeerCountHandler = (count: number) => void;
type AggregatedHandler = (states: AggregatedTrafficState[]) => void;
type ConditionRequestHandler = (req: {
  connId: number;
  id: string;
  cells: string[];
  bucket: { dayOfWeek: number; halfHour: number };
  maxAgeSec: number;
}) => void;
type ConditionResponseHandler = (res: { id: string; entries: WireConditionEntry[] }) => void;
type TileRequestHandler = (req: {
  connId: number;
  id: string;
  z: number;
  x: number;
  y: number;
}) => void;
type TileResponseHandler = (res: { id: string; tile: WireTilePayload | null }) => void;

let worklet: {
  start(entry: string, bundle: string, args: string[]): void;
  terminate(): void;
  IPC: unknown;
} | null = null;
let rpc: { request(cmd: number): { send(data: Uint8Array): void } } | null = null;
let started = false;

let probeHandlers: ProbeHandler[] = [];
let peerCountHandlers: PeerCountHandler[] = [];
let aggregatedHandlers: AggregatedHandler[] = [];
let conditionRequestHandlers: ConditionRequestHandler[] = [];
let conditionResponseHandlers: ConditionResponseHandler[] = [];
let tileRequestHandlers: TileRequestHandler[] = [];
let tileResponseHandlers: TileResponseHandler[] = [];

// ── Lifecycle ───────────────────────────────────────────────────────

/**
 * Start the Bare worklet and establish the RPC channel.
 * No-op if already started or if the bundle isn't available.
 */
export function initHyperswarmBridge(): void {
  if (started || !trafficBundle) return;
  if (!resolveNativeDeps() || !WorkletClass || !RPCClass) return;

  worklet = new WorkletClass();
  const docDir = FileSystem.documentDirectory ?? '';
  worklet.start('/traffic-swarm.bundle', trafficBundle, [String(docDir)]);
  started = true;

  const { IPC } = worklet;
  rpc = new RPCClass(IPC, (req: RpcRequest) => {
    handleWorkletRequest(req);
  });
}

function handleWorkletRequest(req: RpcRequest): void {
  const text = new TextDecoder().decode(req.data);

  switch (req.command) {
    case CMD_INCOMING_PROBE: {
      try {
        const probe: TrafficProbe = JSON.parse(text);
        for (const h of probeHandlers) h(probe);
      } catch {
        /* malformed */
      }
      break;
    }
    case CMD_PEER_COUNT: {
      const count = parseInt(text, 10) || 0;
      for (const h of peerCountHandlers) h(count);
      break;
    }
    case CMD_AGGREGATED_UPDATE: {
      try {
        const states: AggregatedTrafficState[] = JSON.parse(text);
        for (const h of aggregatedHandlers) h(states);
      } catch {
        /* malformed */
      }
      break;
    }
    case CMD_INCOMING_CONDITION_REQUEST: {
      try {
        const req = JSON.parse(text);
        for (const h of conditionRequestHandlers) h(req);
      } catch {
        /* malformed */
      }
      break;
    }
    case CMD_INCOMING_CONDITION_RESPONSE: {
      try {
        const res = JSON.parse(text);
        for (const h of conditionResponseHandlers) h(res);
      } catch {
        /* malformed */
      }
      break;
    }
    case CMD_INCOMING_TILE_REQUEST: {
      try {
        const req = JSON.parse(text);
        for (const h of tileRequestHandlers) h(req);
      } catch {
        /* malformed */
      }
      break;
    }
    case CMD_INCOMING_TILE_RESPONSE: {
      try {
        const res = JSON.parse(text);
        for (const h of tileResponseHandlers) h(res);
      } catch {
        /* malformed */
      }
      break;
    }
  }
}

/**
 * Gracefully shut down the Bare worklet. Terminates the native thread —
 * merely dropping the JS reference (as before) leaked the worklet, leaving
 * its DHT sockets and broadcast interval running in the background.
 */
export function disposeHyperswarmBridge(): void {
  if (rpc) {
    rpc = null;
  }
  if (worklet) {
    try {
      worklet.terminate();
    } catch {
      // Already terminated or native side gone — nothing to do.
    }
    worklet = null;
  }
  started = false;
  probeHandlers = [];
  peerCountHandlers = [];
  aggregatedHandlers = [];
  conditionRequestHandlers = [];
  conditionResponseHandlers = [];
  tileRequestHandlers = [];
  tileResponseHandlers = [];
}

// ── Commands → Worklet ──────────────────────────────────────────────

function sendCommand(command: number, data: string): void {
  if (!rpc) return;
  const req = rpc.request(command);
  req.send(new TextEncoder().encode(data));
}

/** Join a Hyperswarm topic for the given geohash4 cell. */
export function joinTopic(geohash4: string): void {
  sendCommand(CMD_JOIN_TOPIC, geohash4);
}

/** Leave a Hyperswarm topic for the given geohash4 cell. */
export function leaveTopic(geohash4: string): void {
  sendCommand(CMD_LEAVE_TOPIC, geohash4);
}

/** Publish a traffic probe to all connected peers on joined topics. */
export function publishProbe(probeJson: string): void {
  sendCommand(CMD_PUBLISH_PROBE, probeJson);
}

/** Get current Hyperswarm status (peer count, topics, segment count). */
export async function getStatus(): Promise<{
  peerCount: number;
  topicCount: number;
  topics: string[];
  segmentCount: number;
}> {
  if (!rpc) return { peerCount: 0, topicCount: 0, topics: [], segmentCount: 0 };

  return new Promise((resolve) => {
    const req = rpc!.request(CMD_GET_STATUS);
    req.send(new TextEncoder().encode(''));

    // The worklet replies via the RPC response —
    // bare-rpc handles request/reply correlation internally.
    // For now, use the last-reported state as fallback.
    // TODO: Implement proper request/reply once bare-rpc two-way is confirmed
    resolve({ peerCount: 0, topicCount: 0, topics: [], segmentCount: 0 });
  });
}

/** Suspend Hyperswarm connections (call on app background). */
export function suspend(): void {
  sendCommand(CMD_SUSPEND, '');
}

/** Resume Hyperswarm connections (call on app foreground). */
export function resume(): void {
  sendCommand(CMD_RESUME, '');
}

// ── Traffic condition exchange ───────────────────────────────────────

/**
 * Broadcast a traffic condition request to all connected peers.
 * Serialized in the worklet's compact envelope format:
 * `{ t:'cr', id, c:[cells], d:dayOfWeek, h:halfHour, a:maxAgeSec }`
 */
export function requestConditions(req: {
  id: string;
  cells: string[];
  bucket: { dayOfWeek: number; halfHour: number };
  maxAgeSec: number;
}): void {
  sendCommand(
    CMD_REQUEST_CONDITIONS,
    JSON.stringify({
      t: 'cr',
      id: req.id,
      c: req.cells,
      d: req.bucket.dayOfWeek,
      h: req.bucket.halfHour,
      a: req.maxAgeSec,
    }),
  );
}

/**
 * Send condition entries back to a specific peer connection.
 * `connId` comes from the forwarded {@link onConditionRequest} event.
 */
export function sendConditionResponse(
  connId: number,
  requestId: string,
  entries: WireConditionEntry[],
): void {
  sendCommand(CMD_SEND_CONDITION_RESPONSE, JSON.stringify({ connId, requestId, entries }));
}

// ── Traffic tile exchange ────────────────────────────────────────────

/**
 * Broadcast a traffic tile request to all connected peers.
 * Serialized in the worklet's compact envelope format: `{ t:'tr', id, z, x, y }`
 */
export function requestTile(req: { id: string; z: number; x: number; y: number }): void {
  sendCommand(
    CMD_REQUEST_TILE,
    JSON.stringify({ t: 'tr', id: req.id, z: req.z, x: req.x, y: req.y }),
  );
}

/**
 * Send a traffic tile back to a specific peer connection.
 * `connId` comes from the forwarded {@link onTileRequest} event.
 */
export function sendTileResponse(
  connId: number,
  requestId: string,
  tile: WireTilePayload | null,
): void {
  sendCommand(CMD_SEND_TILE_RESPONSE, JSON.stringify({ connId, requestId, tile }));
}

// ── Event handlers ──────────────────────────────────────────────────

export function onProbe(handler: ProbeHandler): () => void {
  probeHandlers.push(handler);
  return () => {
    probeHandlers = probeHandlers.filter((h) => h !== handler);
  };
}

export function onPeerCount(handler: PeerCountHandler): () => void {
  peerCountHandlers.push(handler);
  return () => {
    peerCountHandlers = peerCountHandlers.filter((h) => h !== handler);
  };
}

export function onAggregatedUpdate(handler: AggregatedHandler): () => void {
  aggregatedHandlers.push(handler);
  return () => {
    aggregatedHandlers = aggregatedHandlers.filter((h) => h !== handler);
  };
}

/** A peer asked for traffic conditions; respond via sendConditionResponse. */
export function onConditionRequest(handler: ConditionRequestHandler): () => void {
  conditionRequestHandlers.push(handler);
  return () => {
    conditionRequestHandlers = conditionRequestHandlers.filter((h) => h !== handler);
  };
}

/** A peer responded to one of our condition requests. */
export function onConditionResponse(handler: ConditionResponseHandler): () => void {
  conditionResponseHandlers.push(handler);
  return () => {
    conditionResponseHandlers = conditionResponseHandlers.filter((h) => h !== handler);
  };
}

/** A peer asked for a traffic tile; respond via sendTileResponse. */
export function onTileRequest(handler: TileRequestHandler): () => void {
  tileRequestHandlers.push(handler);
  return () => {
    tileRequestHandlers = tileRequestHandlers.filter((h) => h !== handler);
  };
}

/** A peer responded to one of our tile requests. */
export function onTileResponse(handler: TileResponseHandler): () => void {
  tileResponseHandlers.push(handler);
  return () => {
    tileResponseHandlers = tileResponseHandlers.filter((h) => h !== handler);
  };
}

/** Whether the Bare worklet is currently running. */
export function isStarted(): boolean {
  return started;
}
