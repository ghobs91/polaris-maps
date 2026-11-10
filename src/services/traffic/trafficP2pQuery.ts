import type { TimeBucket, WireConditionEntry } from '../../models/trafficHistory';
import { P2P_QUERY_TIMEOUT_MS, P2P_FRESH_SEC } from '../../models/trafficHistory';
import {
  sendConditionResponse as bridgeSendResponse,
  requestConditions as bridgeRequest,
  onConditionRequest as bridgeOnRequest,
  onConditionResponse as bridgeOnResponse,
  isStarted as isSwarmStarted,
} from './hyperswarmBridge';

/**
 * P2P traffic-condition exchange (RN side).
 *
 * When the local index can't satisfy a request, the app broadcasts a compact
 * `cond_req` on the connected Hyperswarm topics. Peers answer with `cond_res`
 * entries for the requested cells + time bucket. Responses are collected for
 * a short window, then returned (possibly empty).
 *
 * Incoming requests from peers are answered from the local index by the
 * handler wired up in trafficFlowService.
 */

export interface ConditionRequestMessage {
  id: string;
  cells: string[];
  bucket: TimeBucket;
  maxAgeSec: number;
}

export interface ConditionRequestFromPeer extends ConditionRequestMessage {
  /** Connection id in the worklet — used to route the response back. */
  connId: number;
}

interface PendingQuery {
  entries: WireConditionEntry[];
  resolve: (entries: WireConditionEntry[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingQueries = new Map<string, PendingQuery>();
let requestCounter = 0;

function nextRequestId(): string {
  requestCounter = (requestCounter + 1) % 1_000_000;
  return `p2p${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

/**
 * Ask connected peers for conditions covering the given cells for a time
 * bucket. Resolves with all entries received within the timeout.
 *
 * Returns [] when the swarm is not running (no peers to ask).
 */
export function queryPeersForConditions(
  cells: string[],
  bucket: TimeBucket,
  maxAgeSec: number = P2P_FRESH_SEC,
  timeoutMs: number = P2P_QUERY_TIMEOUT_MS,
): Promise<WireConditionEntry[]> {
  if (!isSwarmStarted() || cells.length === 0) return Promise.resolve([]);

  return new Promise((resolve) => {
    const id = nextRequestId();
    const pending: PendingQuery = {
      entries: [],
      resolve,
      timer: setTimeout(() => {
        const p = pendingQueries.get(id);
        if (p) {
          pendingQueries.delete(id);
          p.resolve(p.entries);
        }
      }, timeoutMs),
    };
    pendingQueries.set(id, pending);
    bridgeRequest({ id, cells, bucket, maxAgeSec });
  });
}

/**
 * Hybrid tier-3 condition query: ask the Hyperswarm mesh and the Nostr
 * relay profile store in parallel and merge the answers.
 *
 * Nostr profile events are stored (parameterized-replaceable, kind 30110),
 * so relays answer even when no live peers are online — this is what turns
 * the weekly-history cache into a shared P2P asset instead of a per-device
 * one. When the Nostr fallback sockets aren't connected (healthy swarm),
 * the relay leg returns [] and this reduces to the swarm-only query.
 *
 * Entries are deduped per cell, keeping the answer with the larger sample
 * count. Never rejects — transport failures resolve to no data.
 */
export async function queryConditionsHybrid(
  cells: string[],
  bucket: TimeBucket,
  maxAgeSec: number = P2P_FRESH_SEC,
  timeoutMs: number = P2P_QUERY_TIMEOUT_MS,
): Promise<WireConditionEntry[]> {
  // Lazy-required so the Nostr/WebSocket modules stay out of unit tests
  // and environments without the relay stack.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exchange = require('./nostrProfileExchange') as typeof import('./nostrProfileExchange');
  const [swarmEntries, nostrEntries] = await Promise.all([
    queryPeersForConditions(cells, bucket, maxAgeSec, timeoutMs),
    exchange.queryNostrProfiles(cells, bucket, timeoutMs).catch(() => [] as WireConditionEntry[]),
  ]);
  if (nostrEntries.length === 0) return swarmEntries;

  return exchange.mergeConditionEntries(swarmEntries, nostrEntries);
}

/** Wire the response collector into the bridge (called once at startup). */
export function initP2pConditionQuery(): void {
  bridgeOnResponse((res) => {
    const pending = pendingQueries.get(res.id);
    if (!pending) return; // Not ours / already timed out
    pending.entries.push(...res.entries);
  });
}

/** Register a handler for incoming condition requests from peers. */
export function onPeerConditionRequest(
  handler: (req: ConditionRequestFromPeer) => void,
): () => void {
  return bridgeOnRequest(handler);
}

/** Send condition entries back to the peer that requested them. */
export function respondToConditionRequest(
  connId: number,
  requestId: string,
  entries: WireConditionEntry[],
): void {
  bridgeSendResponse(connId, requestId, entries);
}

// Re-export the pure wire helpers for callers that need them.
export { conditionToWire, wireToEntry } from './p2pConditionWire';
