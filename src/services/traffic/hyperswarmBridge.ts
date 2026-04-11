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
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    WorkletClass = (require('react-native-bare-kit') as { Worklet: typeof WorkletClass }).Worklet;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
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

import * as FileSystem from 'expo-file-system';
import {
  CMD_JOIN_TOPIC,
  CMD_LEAVE_TOPIC,
  CMD_PUBLISH_PROBE,
  CMD_GET_STATUS,
  CMD_INCOMING_PROBE,
  CMD_PEER_COUNT,
  CMD_AGGREGATED_UPDATE,
  CMD_SUSPEND,
  CMD_RESUME,
} from './rpcCommands';
import type { AggregatedTrafficState, TrafficProbe } from '../../models/traffic';

// The bundle is produced by `npx bare-pack --target ios --target android --linked`
// eslint-disable-next-line @typescript-eslint/no-var-requires
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

let worklet: { start(entry: string, bundle: string, args: string[]): void; IPC: unknown } | null =
  null;
let rpc: { request(cmd: number): { send(data: Uint8Array): void } } | null = null;
let started = false;

let probeHandlers: ProbeHandler[] = [];
let peerCountHandlers: PeerCountHandler[] = [];
let aggregatedHandlers: AggregatedHandler[] = [];

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
  }
}

/** Gracefully shut down the Bare worklet. */
export function disposeHyperswarmBridge(): void {
  if (rpc) {
    rpc = null;
  }
  if (worklet) {
    worklet = null;
  }
  started = false;
  probeHandlers = [];
  peerCountHandlers = [];
  aggregatedHandlers = [];
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

/** Whether the Bare worklet is currently running. */
export function isStarted(): boolean {
  return started;
}
