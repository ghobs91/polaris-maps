/**
 * Region-manifest gossip.
 *
 * Distributes signed region manifests peer-to-peer over Gun.js so discovery no
 * longer depends on the Polaris CDN catalog: clients subscribe to the namespace,
 * verify and merge incoming manifests, persist what they trust, and relay it
 * back so the network has no single origin.
 *
 * See `openspec/changes/add-region-manifest-gossip/`.
 */

import { storage } from '../storage/mmkv';
import { TRUSTED_REGION_PUBLISHERS } from '../../constants/regionPublishers';
import {
  compareManifestVersion,
  verifyRegionManifest,
  type RegionManifest,
} from './regionManifest';
import { setRemoteRegionManifests } from './regionManifestResolver';

const STORE_KEY = 'region_manifests_v1';
/** Total persisted remote manifests kept (bounded). */
const STORE_MAX = 200;
const NS_ROOT = 'polaris';
const NS = 'region-manifests';

/** Minimal Gun surface used here (injectable so it can be faked in tests). */
export interface GunNode {
  get(key: string): GunNode;
  put(value: unknown): void;
  map(): GunNode;
  on(cb: (value: unknown, key: string) => void, opt?: boolean): void;
}
export interface GunLike {
  get(key: string): GunNode;
}

function asManifest(value: unknown): RegionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const record = { ...(value as Record<string, unknown>) };
  delete record._; // Gun metadata
  if (
    typeof record.regionId !== 'string' ||
    typeof record.version !== 'string' ||
    typeof record.driveKey !== 'string' ||
    typeof record.discoveryKey !== 'string' ||
    typeof record.contentHash !== 'string' ||
    typeof record.publisherPubkey !== 'string' ||
    typeof record.signature !== 'string'
  ) {
    return null;
  }
  return record as unknown as RegionManifest;
}

/**
 * Add a received manifest to a candidate set. Returns the new set, or null when
 * nothing changed (invalid, untrusted, or not newer than what a publisher
 * already advertised).
 */
export function ingestManifest(
  existing: readonly RegionManifest[],
  incoming: RegionManifest,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): RegionManifest[] | null {
  if (!verifyRegionManifest(incoming, trusted)) return null;

  const publisher = incoming.publisherPubkey.trim().toLowerCase();
  const index = existing.findIndex(
    (m) => m.regionId === incoming.regionId && m.publisherPubkey.trim().toLowerCase() === publisher,
  );
  if (index === -1) return [...existing, incoming];
  if (compareManifestVersion(incoming.version, existing[index].version) > 0) {
    const next = [...existing];
    next[index] = incoming;
    return next;
  }
  return null;
}

/** Load persisted (verified) remote manifests. */
export function loadPersistedManifests(): RegionManifest[] {
  const raw = storage.getString(STORE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(asManifest).filter((m): m is RegionManifest => m !== null);
  } catch {
    return [];
  }
}

/** Persist remote manifests, keeping the newest per (region, publisher), bounded. */
export function persistManifests(manifests: readonly RegionManifest[]): void {
  const keyed = new Map<string, RegionManifest>();
  for (const manifest of manifests) {
    const key = `${manifest.regionId}\u0000${manifest.publisherPubkey.trim().toLowerCase()}`;
    const previous = keyed.get(key);
    if (!previous || compareManifestVersion(manifest.version, previous.version) > 0) {
      keyed.set(key, manifest);
    }
  }
  storage.set(STORE_KEY, JSON.stringify([...keyed.values()].slice(-STORE_MAX)));
}

/** Publish (or relay) a manifest to the gossip namespace. */
export function publishRegionManifest(gun: GunLike, manifest: RegionManifest): void {
  gun
    .get(NS_ROOT)
    .get(NS)
    .get(manifest.regionId)
    .get(manifest.publisherPubkey.trim().toLowerCase())
    .put(manifest);
}

/** Subscribe to manifests in the namespace. */
export function subscribeRegionManifests(
  gun: GunLike,
  onManifest: (manifest: RegionManifest) => void,
): void {
  gun
    .get(NS_ROOT)
    .get(NS)
    .map()
    .map()
    .on((value) => {
      const manifest = asManifest(value);
      if (manifest) onManifest(manifest);
    });
}

/**
 * Start gossip: load persisted manifests into the resolver, subscribe for new
 * ones (verify → merge → persist → relay), and relay what is already held.
 * Returns a cleanup function.
 */
export function startRegionManifestGossip(
  gun: GunLike,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): () => void {
  let manifests = loadPersistedManifests();
  setRemoteRegionManifests(manifests);

  subscribeRegionManifests(gun, (incoming) => {
    const next = ingestManifest(manifests, incoming, trusted);
    if (!next) return;
    manifests = next;
    persistManifests(manifests);
    setRemoteRegionManifests(manifests);
    publishRegionManifest(gun, incoming); // relay
  });

  // Relay what we already hold so peers can discover it.
  for (const manifest of manifests) publishRegionManifest(gun, manifest);

  return () => {};
}
