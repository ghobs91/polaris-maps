/**
 * Signed, remote feature flags (kill switches).
 *
 * Polaris does not run a user-data backend. This is a single static JSON file
 * on the project's existing site, signed with the same secp256k1 publisher key
 * trusted for region manifests. The app verifies the signature before applying
 * anything, caches the last good copy, and otherwise runs with safe defaults
 * (everything enabled).
 *
 * Purpose: when a third-party origin blocks the app (tiles, geocoders, street
 * imagery), the affected feature can be turned off without an App Store
 * release. Flags are intentionally coarse — no per-user targeting, no IDs.
 */

import { isTrustedPublisher } from '../regions/regionManifest';
import { setOverpassEnabled } from '../overpassClient';
import { createSigningPayload, verify } from '../identity/signing';
import { TRUSTED_REGION_PUBLISHERS } from '../../constants/regionPublishers';
import type { MMKV } from 'react-native-mmkv';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/** Static config location. Override to self-host the same signed JSON. */
export const REMOTE_CONFIG_URL =
  process.env.EXPO_PUBLIC_REMOTE_CONFIG_URL ?? 'https://app.polarismaps.app/config.json';

const CACHE_KEY = 'remote_config:v1';
const FETCH_TIMEOUT_MS = 3_000;

export type RemoteFlag =
  | 'trafficP2P'
  | 'regionDownloads'
  | 'streetView'
  | 'overturePlaces'
  | 'tomtomBridge';

export interface RemoteConfigFlags {
  /** Hyperswarm/Nostr traffic mesh + probe contribution. */
  trafficP2P: boolean;
  /** Offline region pack downloads (OpenFreeMap + GitHub Releases). */
  regionDownloads: boolean;
  /** Online street-level imagery lookups (Google/Mapillary/Panoramax). */
  streetView: boolean;
  /** Overture PMTiles viewport/search enrichment. */
  overturePlaces: boolean;
  /** TomTom cold-start traffic bridge (flow grid, tiles, route ETA). */
  tomtomBridge: boolean;
  /**
   * Public Overpass fallback for areas with no local pack coverage.
   *
   * Deliberately NOT part of {@link FLAG_ORDER}: the signature covers the
   * original five flags, and adding a field to the signed payload would
   * invalidate every config already published. This flag is fail-safe by
   * construction — absent defaults to enabled, and its only effect is to turn
   * an optional third-party fallback *off*.
   *
   * Nothing depends on the config being reachable: the fallback runs enabled
   * without it. Polaris hosts no control-plane service, so this signed static
   * document (and `setOverpassEnabled` for a local override) are the only
   * switches, and losing both leaves the app fully functional.
   */
  overpassQuery: boolean;
}

export interface RemoteConfig {
  version: number;
  issuedAt: string;
  flags: RemoteConfigFlags;
  publisherPubkey: string;
  signature: string;
}

/** Safe defaults: every feature on when no signed config is available. */
export const DEFAULT_REMOTE_FLAGS: RemoteConfigFlags = {
  trafficP2P: true,
  regionDownloads: true,
  streetView: true,
  overturePlaces: true,
  tomtomBridge: true,
  overpassQuery: true,
};

/** Fixed flag order for the canonical signing payload. Do not reorder. */
const FLAG_ORDER: readonly RemoteFlag[] = [
  'trafficP2P',
  'regionDownloads',
  'streetView',
  'overturePlaces',
  'tomtomBridge',
];

let current: RemoteConfigFlags = { ...DEFAULT_REMOTE_FLAGS };
let initPromise: Promise<void> | null = null;
const listeners = new Set<(flags: RemoteConfigFlags) => void>();

/** Canonical byte string a config signature covers. */
export function remoteConfigPayload(
  core: Omit<RemoteConfig, 'signature' | 'flags'> & { flags: RemoteConfigFlags },
): string {
  return createSigningPayload(
    core.version,
    core.issuedAt,
    ...FLAG_ORDER.map((flag) => (core.flags[flag] ? 1 : 0)),
    core.publisherPubkey,
  );
}

/**
 * Parse and verify a remote-config document.
 *
 * Returns the effective flags only when the signature verifies against a
 * trusted publisher; malformed or unsigned documents yield null. Missing flag
 * keys default to enabled so adding a flag cannot accidentally disable it.
 */
export function parseRemoteConfig(
  value: unknown,
  trusted: readonly string[] = TRUSTED_REGION_PUBLISHERS,
): RemoteConfigFlags | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Partial<RemoteConfig>;

  if (
    typeof config.version !== 'number' ||
    !Number.isInteger(config.version) ||
    config.version < 1
  ) {
    return null;
  }
  if (typeof config.issuedAt !== 'string' || Number.isNaN(Date.parse(config.issuedAt))) {
    return null;
  }
  if (typeof config.publisherPubkey !== 'string' || typeof config.signature !== 'string') {
    return null;
  }
  if (!isTrustedPublisher(config.publisherPubkey, trusted)) return null;

  const rawFlags =
    config.flags && typeof config.flags === 'object'
      ? (config.flags as Partial<RemoteConfigFlags>)
      : {};
  const flags: RemoteConfigFlags = { ...DEFAULT_REMOTE_FLAGS };
  for (const flag of FLAG_ORDER) {
    if (typeof rawFlags[flag] === 'boolean') flags[flag] = rawFlags[flag]!;
  }
  // Unsigned on purpose (see RemoteConfigFlags.overpassQuery).
  if (typeof rawFlags.overpassQuery === 'boolean') flags.overpassQuery = rawFlags.overpassQuery;

  const payload = remoteConfigPayload({
    version: config.version,
    issuedAt: config.issuedAt,
    flags,
    publisherPubkey: config.publisherPubkey,
  });
  if (!verify(payload, config.signature, config.publisherPubkey)) return null;

  return flags;
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      // A listener must not break the others.
    }
  }
}

/** Lazy MMKV lookup; importing it eagerly pulls native modules into Jest. */
function getCache(): MMKV | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../storage/mmkv') as typeof import('../storage/mmkv');
    return mod.storage;
  } catch {
    return null;
  }
}

/**
 * Apply a verified flag set. Exported so the loader, cache hydration, and tests
 * all go through exactly one side-effecting path.
 */
export function applyRemoteFlags(flags: RemoteConfigFlags): void {
  current = { ...flags };
  // Keep the Overpass client's kill switch in sync with the signed config.
  setOverpassEnabled(flags.overpassQuery !== false);
  notify();
}

function hydrateFromCache(): void {
  try {
    const raw = getCache()?.getString(CACHE_KEY);
    if (!raw) return;
    const flags = parseRemoteConfig(JSON.parse(raw));
    if (flags) {
      applyRemoteFlags(flags);
    }
  } catch {
    // Corrupt cache — defaults apply.
  }
}

async function fetchRemoteConfig(): Promise<RemoteConfigFlags | null> {
  if (!REMOTE_CONFIG_URL) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REMOTE_CONFIG_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      logDiagnostic('remote-config', 'warn', `config fetch failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as unknown;
    const flags = parseRemoteConfig(body);
    if (!flags) {
      logDiagnostic('remote-config', 'warn', 'config rejected: invalid signature or shape');
      return null;
    }
    // Cache the original signed document so hydration re-verifies it.
    try {
      getCache()?.set(CACHE_KEY, JSON.stringify(body));
    } catch {
      // Cache failures are non-fatal.
    }
    return flags;
  } catch (error) {
    logDiagnostic(
      'remote-config',
      'warn',
      `config fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the last-good config from disk, then refresh from the static endpoint
 * once per session. Never throws; defaults are the fallback.
 */
export function initRemoteConfig(): Promise<void> {
  if (initPromise) return initPromise;
  hydrateFromCache();
  initPromise = fetchRemoteConfig().then((flags) => {
    if (flags) applyRemoteFlags(flags);
  });
  return initPromise;
}

/** Current effective flags (cached/defaults before the first fetch resolves). */
export function getRemoteFlags(): RemoteConfigFlags {
  return current;
}

/** True unless a verified remote config explicitly disabled the feature. */
export function isFeatureEnabled(flag: RemoteFlag): boolean {
  return current[flag];
}

/** Subscribe to flag changes (returns an unsubscribe function). */
export function subscribeRemoteConfig(listener: (flags: RemoteConfigFlags) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: reset module state without touching the disk cache. */
export function __resetRemoteConfigForTests(): void {
  current = { ...DEFAULT_REMOTE_FLAGS };
  initPromise = null;
  listeners.clear();
}
