/**
 * Register a downloaded pack's shards as fetchable sources.
 *
 * The pack already contains its shards (they are committed in the pack index and
 * covered by the region manifest's content hash), and every peer seeding that
 * pack holds them. So the primary source is a local file read — the same bytes a
 * peer would serve. Peers and community archives can be added later through
 * `configureShardSources` without changing this module.
 *
 * Trust model:
 * - `shards.manifest.json`, when present and signed by a trusted publisher, is
 *   verified with `verifyShardManifest`; its descriptors are authoritative.
 * - Otherwise `shards.json` (produced by the builder) is used, which authenticates
 *   the *bytes* of each shard (SHA-256 + Merkle root) but not the shard set.
 *   That is still safe: nothing unverified can enter the index, and a wrong set
 *   only means fewer rows than a full pack would give.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { logDiagnostic } from '../diagnostics/diagnosticsLog';
import {
  verifyShardManifest,
  type ShardDescriptor,
  type ShardManifest,
  type ShardSource,
} from './shardManifest';
import { configureShardSources } from '../poi/shardedPoiSource';

interface ShardFileIndex {
  shards: ShardDescriptor[];
  signed: boolean;
  publisherPubkey?: string;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Decode a base64 string (expo-file-system's requested encoding) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atobBytes(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function atobBytes(base64: string): string {
  const globalAtob = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof globalAtob === 'function') return globalAtob(base64);
  // Hermes without atob: manual decode.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of base64.replace(/[^A-Za-z0-9+/]/g, '')) {
    buffer = (buffer << 6) | chars.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

/**
 * Load a pack's shard descriptors.
 *
 * Prefers the signed manifest when one is present and verifies; falls back to
 * the builder's unsigned index so a pack published before signing still works.
 */
export async function loadPackShardIndex(dirPath: string): Promise<ShardFileIndex | null> {
  const base = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;

  const signed = await readJson<ShardManifest>(`${base}shards.manifest.json`);
  if (signed && verifyShardManifest(signed)) {
    return { shards: signed.shards, signed: true, publisherPubkey: signed.publisherPubkey };
  }
  if (signed) {
    logDiagnostic('shards', 'warn', 'signed shard manifest rejected', {
      regionId: signed.regionId,
    });
  }

  const unsigned = await readJson<{ shards?: ShardDescriptor[] }>(`${base}shards.json`);
  if (!unsigned?.shards?.length) return null;
  return { shards: unsigned.shards, signed: false };
}

/** Build file-backed shard readers for a pack directory. */
export function packShardSources(
  dirPath: string,
  shards: readonly ShardDescriptor[],
): ShardSource[] {
  const base = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  return shards.map((shard) => ({
    kind: 'peer' as const,
    label: `pack:${shard.shardId}`,
    read: async (signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error('Aborted');
      const base64 = await FileSystem.readAsStringAsync(`${base}${shard.path}`, {
        encoding: 'base64',
      });
      return base64ToBytes(base64);
    },
  }));
}

/**
 * Register a pack's shards for viewport fetching.
 *
 * Called after a pack download/import. Returns how many shards are available so
 * the caller can log the coverage story honestly.
 */
export async function registerPackShards(
  regionId: string,
  dirPath: string,
): Promise<{ shards: number; signed: boolean }> {
  const index = await loadPackShardIndex(dirPath);
  if (!index) return { shards: 0, signed: false };

  configureShardSources({
    // Descriptors are only as trustworthy as their source; `signed` records that.
    shardSets: [index.shards],
    sources: packShardSources(dirPath, index.shards),
  });

  logDiagnostic('shards', 'info', 'registered pack shards', {
    regionId,
    shards: index.shards.length,
    signed: index.signed,
  });

  return { shards: index.shards.length, signed: index.signed };
}
