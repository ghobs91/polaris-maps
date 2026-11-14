/**
 * Peer POI queries (tier 2 fallback).
 *
 * When neither a downloaded pack nor a fetchable shard covers an area, ask the
 * swarm: peers seeding that pack hold the shard bytes and can answer a predicate
 * query with Merkle inclusion proofs. Answers are verified against the root from
 * the signed shard manifest, so a peer can only omit rows — never invent them.
 *
 * Rows returned here are used for the current query only. They are deliberately
 * NOT imported into the local index and do NOT mark coverage: a filtered answer
 * says nothing about the rest of the cell, and claiming coverage from it would
 * make later queries look complete when they are not.
 */

import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import type { ShardDescriptor } from '../regions/shardManifest';
import { shardsForBounds } from '../regions/shardManifest';
import { queryPeersForEntries } from './hyperswarmShardClient';
import { getShardSources } from './shardedPoiSource';
import type { OsmPoi } from './osmFetcher';
import type { ShardEntry } from './verifiableShardIndex';

export interface PeerPoiQuery {
  south: number;
  west: number;
  north: number;
  east: number;
  keys?: ReadonlyArray<{ key: string; value?: string }>;
  tags?: ReadonlyArray<readonly [string, string]>;
  limit?: number;
  timeoutMs?: number;
}

function entryToPoi(entry: ShardEntry): OsmPoi {
  return {
    id: entry.osmId,
    lat: entry.lat,
    lng: entry.lng,
    name: entry.name,
    type: entry.primaryKey,
    subtype: entry.subtype,
    tags: entry.tags,
  };
}

/** Shard descriptors that could answer this query, across registered packs. */
export function peerQueryCandidates(query: PeerPoiQuery): ShardDescriptor[] {
  const bounds = { south: query.south, west: query.west, north: query.north, east: query.east };
  return getShardSources().shardSets.flatMap((shards) => shardsForBounds(shards, bounds));
}

/**
 * Ask peers for matching rows in every shard intersecting the box.
 *
 * Returns an empty array when no peer answers, nothing verifies, or no shard is
 * registered — the caller then falls through to Overpass.
 */
export async function queryPeersForPois(query: PeerPoiQuery): Promise<OsmPoi[]> {
  const candidates = peerQueryCandidates(query);
  if (candidates.length === 0) return [];

  const results = await Promise.all(
    candidates.map(async (descriptor) => {
      try {
        const entries = await queryPeersForEntries(
          descriptor.shardId,
          descriptor.merkleRoot,
          {
            keys: query.keys?.map((filter) => ({ key: filter.key, value: filter.value })),
            tags: query.tags?.map(([key, value]) => [key, value] as [string, string]),
            bounds: {
              south: Math.max(query.south, descriptor.south),
              west: Math.max(query.west, descriptor.west),
              north: Math.min(query.north, descriptor.north),
              east: Math.min(query.east, descriptor.east),
            },
          },
          { timeoutMs: query.timeoutMs, limit: query.limit },
        );
        return entries.map(entryToPoi);
      } catch (err) {
        logDiagnostic('shards', 'info', 'peer POI query failed', {
          shardId: descriptor.shardId,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  const merged: OsmPoi[] = [];
  for (const poi of results.flat()) {
    const key = `${poi.tags?.['polaris:osmType'] ?? 'node'}/${poi.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(poi);
  }
  return merged;
}
