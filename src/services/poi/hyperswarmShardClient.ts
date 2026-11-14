/**
 * Peer shard queries over Hyperswarm (Tier 2 transport, app side).
 *
 * Wraps the Bare worklet's shard-query RPC: the worklet joins the shard's swarm
 * topic, broadcasts the query, and hands back the first reply. Nothing from the
 * swarm is trusted — every answer goes through `verifyShardAnswer` against the
 * Merkle root committed in the signed shard manifest, and a short answer is
 * rejected when the committed row count is known.
 *
 * Polaris runs no server here: the peers answering are devices seeding the same
 * region pack, which already hold the shard bytes.
 */

import { sha256 } from '@noble/hashes/sha256';

import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import { queryShardOverSwarm } from '../sync/hyperdriveBridge';
import {
  requestShardAnswer,
  type ShardQuery,
  type VerifiedShardResponse,
} from './shardQueryProtocol';
import type { ShardEntry } from './verifiableShardIndex';

/** 32-byte Hyperswarm topic for a shard. Must match `backend/shard-answer.mjs`. */
export function shardTopicFor(shardId: string): Uint8Array {
  return sha256(new TextEncoder().encode(`polaris/shard/${shardId}`));
}

export interface PeerQueryOptions {
  /** Total budget for peer discovery + answer. */
  timeoutMs?: number;
  /** Rows the shard is committed to contain for this predicate, when known. */
  expectedCount?: number;
}

/**
 * Ask peers for a shard answer and verify it.
 *
 * Returns `null` when no peer answered within the budget. A reply that fails
 * verification is returned with `verification.ok === false` and empty entries —
 * callers must not use it.
 */
export async function queryPeersForShard(
  query: ShardQuery,
  opts?: PeerQueryOptions,
): Promise<VerifiedShardResponse | null> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;

  let answer: unknown;
  try {
    answer = await queryShardOverSwarm(query.shardId, query as unknown as Record<string, unknown>, {
      timeoutMs,
    });
  } catch (err) {
    logDiagnostic('shards', 'info', 'peer shard query failed', {
      shardId: query.shardId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!answer || typeof answer !== 'object') return null;

  const response = {
    version: 1,
    shardId: query.shardId,
    answer,
    truncated: (answer as { truncated?: boolean }).truncated === true,
  };

  try {
    const verified = await requestShardAnswer(
      { send: async () => response },
      query,
      opts?.expectedCount === undefined ? undefined : { expectedCount: opts.expectedCount },
    );
    if (!verified.verification.ok) {
      logDiagnostic('shards', 'warn', 'peer shard answer rejected', {
        shardId: query.shardId,
        reason: verified.verification.reason,
        rejected: verified.verification.rejected,
      });
      return null;
    }
    return verified;
  } catch (err) {
    logDiagnostic('shards', 'warn', 'peer shard answer malformed', {
      shardId: query.shardId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Convenience: ask peers for rows matching a predicate, verified. */
export async function queryPeersForEntries(
  shardId: string,
  merkleRoot: string,
  predicate: Pick<ShardQuery, 'keys' | 'tags' | 'bounds'>,
  opts?: PeerQueryOptions & { limit?: number },
): Promise<ShardEntry[]> {
  const result = await queryPeersForShard(
    {
      version: 1,
      shardId,
      merkleRoot,
      keys: predicate.keys,
      tags: predicate.tags,
      bounds: predicate.bounds,
      limit: opts?.limit ?? 500,
    },
    opts,
  );
  return result?.entries ?? [];
}
