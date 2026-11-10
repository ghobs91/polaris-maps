/**
 * Peer shard-query protocol (Tier 2, transport-agnostic).
 *
 * Tier 0 answers from local data and tier 1 fetches verified cells. This layer
 * is for the long tail — a predicate no precomputed cell satisfies — where some
 * *other device* computes the answer. The only question that matters is why
 * believe it, so every answer is a set of entries plus Merkle inclusion proofs
 * that the client checks against the root committed in the signed shard
 * manifest. A responder is trusted for nothing: it can only omit (which the
 * committed `poiCount` exposes) and never fabricate.
 *
 * Deliberately transport-free: it takes a `send` function, so the Hyperswarm/
 * Hyperdrive binding can be swapped in (and tested) without touching this
 * logic. Nothing here assumes a Polaris-run server exists.
 */

import {
  buildShardAnswer,
  verifyShardAnswer,
  type ShardAnswer,
  type ShardEntry,
  type ShardAnswerVerification,
} from './verifiableShardIndex';

export const SHARD_PROTOCOL_VERSION = 1;

/** Query shape. Kept small and declarative so responders stay cheap. */
export interface ShardQuery {
  version: typeof SHARD_PROTOCOL_VERSION;
  shardId: string;
  /** Root the requester trusts (from the signed manifest). */
  merkleRoot: string;
  /** Primary tag predicates, OR-ed. Empty means "any". */
  keys?: Array<{ key: string; value?: string }>;
  /** Extra `tag=value` predicates, AND-ed. */
  tags?: Array<[string, string]>;
  /** Optional sub-box inside the shard. */
  bounds?: { south: number; west: number; north: number; east: number };
  /** Maximum rows the requester will accept. */
  limit: number;
}

export interface ShardQueryResponse {
  version: typeof SHARD_PROTOCOL_VERSION;
  shardId: string;
  answer: ShardAnswer;
  /** True when the responder stopped early because of `limit`. */
  truncated: boolean;
}

export const MAX_QUERY_LIMIT = 5_000;
export const DEFAULT_QUERY_LIMIT = 500;

export class ShardProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShardProtocolError';
  }
}

/** Clamp and validate an inbound query, rejecting malformed input. */
export function normalizeShardQuery(value: unknown): ShardQuery {
  if (!value || typeof value !== 'object') throw new ShardProtocolError('query must be an object');
  const raw = value as Partial<ShardQuery>;

  if (raw.version !== SHARD_PROTOCOL_VERSION) {
    throw new ShardProtocolError(`unsupported protocol version: ${String(raw.version)}`);
  }
  if (typeof raw.shardId !== 'string' || raw.shardId.length === 0) {
    throw new ShardProtocolError('shardId is required');
  }
  if (typeof raw.merkleRoot !== 'string' || !/^[0-9a-f]{64}$/i.test(raw.merkleRoot)) {
    throw new ShardProtocolError('merkleRoot must be a 64-character hex string');
  }

  const keys = Array.isArray(raw.keys)
    ? raw.keys
        .filter(
          (entry): entry is { key: string; value?: string } =>
            !!entry && typeof entry.key === 'string',
        )
        .map((entry) => ({
          key: entry.key,
          value: typeof entry.value === 'string' ? entry.value : undefined,
        }))
    : undefined;

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(
        (entry): entry is [string, string] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string',
      )
    : undefined;

  let bounds: ShardQuery['bounds'];
  if (raw.bounds && typeof raw.bounds === 'object') {
    const { south, west, north, east } = raw.bounds;
    if ([south, west, north, east].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      bounds = { south: south!, west: west!, north: north!, east: east! };
    }
  }

  const limit = Math.max(
    1,
    Math.min(
      Math.trunc(
        typeof raw.limit === 'number' && Number.isFinite(raw.limit)
          ? raw.limit
          : DEFAULT_QUERY_LIMIT,
      ),
      MAX_QUERY_LIMIT,
    ),
  );

  return {
    version: SHARD_PROTOCOL_VERSION,
    shardId: raw.shardId,
    merkleRoot: raw.merkleRoot,
    keys,
    tags,
    bounds,
    limit,
  };
}

/** True when an entry satisfies the query's predicates. */
export function matchesShardQuery(entry: ShardEntry, query: ShardQuery): boolean {
  if (query.bounds) {
    const { south, west, north, east } = query.bounds;
    if (entry.lat < south || entry.lat > north || entry.lng < west || entry.lng > east)
      return false;
  }
  if (query.keys && query.keys.length > 0) {
    const matchesKey = query.keys.some(
      (filter) =>
        entry.primaryKey === filter.key &&
        (filter.value === undefined || entry.subtype === filter.value),
    );
    if (!matchesKey) return false;
  }
  for (const [key, value] of query.tags ?? []) {
    if (entry.tags?.[key] !== value) return false;
  }
  return true;
}

export interface ShardResponderOptions {
  /** Load a shard's committed entries (from the local index). */
  loadShard: (shardId: string) => Promise<ShardEntry[]>;
  /** Max rows per answer; defaults to MAX_QUERY_LIMIT. */
  maxRows?: number;
}

/**
 * Build a responder. It never mutates the query's trust inputs: the answer's
 * root is recomputed from the shard it holds, so a requester with a different
 * root simply fails verification rather than being told what to trust.
 */
export function createShardResponder(options: ShardResponderOptions) {
  const maxRows = Math.min(options.maxRows ?? MAX_QUERY_LIMIT, MAX_QUERY_LIMIT);

  return async function respond(rawQuery: unknown): Promise<ShardQueryResponse> {
    const query = normalizeShardQuery(rawQuery);
    const entries = await options.loadShard(query.shardId);

    const matching = entries.filter((entry) => matchesShardQuery(entry, query));
    const limited = matching.slice(0, Math.min(query.limit, maxRows));

    // The root comes from the whole shard, not the matching subset, so proofs
    // chain to the root the signed manifest committed.
    const answer: ShardAnswer = buildShardAnswer(entries, (entry) => limited.includes(entry));

    return {
      version: SHARD_PROTOCOL_VERSION,
      shardId: query.shardId,
      answer,
      truncated: limited.length < matching.length,
    };
  };
}

export interface ShardQueryClient {
  send: (query: ShardQuery) => Promise<unknown>;
}

export interface VerifiedShardResponse {
  entries: ShardEntry[];
  truncated: boolean;
  verification: ShardAnswerVerification;
}

/**
 * Ask a peer, then verify the reply against the trusted root.
 *
 * A reply whose proofs do not chain to `query.merkleRoot` yields
 * `verification.ok === false`; callers must not use its entries.
 */
export async function requestShardAnswer(
  client: ShardQueryClient,
  query: ShardQuery,
  opts?: { expectedCount?: number },
): Promise<VerifiedShardResponse> {
  const normalized = normalizeShardQuery(query);
  const raw = await client.send(normalized);

  if (!raw || typeof raw !== 'object') throw new ShardProtocolError('response must be an object');
  const response = raw as Partial<ShardQueryResponse>;
  if (response.version !== SHARD_PROTOCOL_VERSION) {
    throw new ShardProtocolError(`unsupported response version: ${String(response.version)}`);
  }
  if (response.shardId !== normalized.shardId) {
    throw new ShardProtocolError('response shardId does not match the request');
  }
  if (!response.answer || !Array.isArray(response.answer.entries)) {
    throw new ShardProtocolError('response is missing an answer');
  }

  const verification = verifyShardAnswer(normalized.merkleRoot, response.answer);
  const truncated = response.truncated === true;

  // A complete (non-truncated) answer must cover every committed row; a short
  // answer is a responder that dropped entries.
  if (
    verification.ok &&
    !truncated &&
    typeof opts?.expectedCount === 'number' &&
    verification.verified.length !== opts.expectedCount
  ) {
    return {
      entries: [],
      truncated,
      verification: {
        ok: false,
        verified: [],
        rejected: verification.verified.length,
        reason: 'incomplete',
      },
    };
  }

  return { entries: verification.ok ? verification.verified : [], truncated, verification };
}

/** Simple per-peer token bucket so one requester cannot monopolise a node. */
export function createQueryRateLimiter(options: {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}) {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const now = options.now ?? Date.now;

  return function allow(peerId: string): boolean {
    const at = now();
    const bucket = buckets.get(peerId) ?? { tokens: options.capacity, updatedAt: at };
    const elapsedSeconds = Math.max(0, (at - bucket.updatedAt) / 1000);
    const tokens = Math.min(
      options.capacity,
      bucket.tokens + elapsedSeconds * options.refillPerSecond,
    );
    const allowed = tokens >= 1;
    buckets.set(peerId, { tokens: allowed ? tokens - 1 : tokens, updatedAt: at });
    return allowed;
  };
}
