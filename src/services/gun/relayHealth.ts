/**
 * Gun relay health.
 *
 * Gun sync is the app's only realtime peer layer, and its seed list is a set of
 * public relays the project does not operate. Public relays come and go — the
 * classic `gun-*.herokuapp.com` demo hosts died with Heroku's free tier — and a
 * dead relay in the seed list means every sync attempt waits for a timeout
 * before reaching a live one.
 *
 * This module resolves the relay set and keeps it honest:
 *
 *   explicit config (env)  →  last known healthy set  →  seeds
 *
 * Health is probed in the background (never blocking Gun's start) and cached
 * with a TTL, so a dead seed drops out of the working set on the next session
 * instead of poisoning every launch. It never invents relays: a probe can only
 * remove a candidate, never add one.
 *
 * ## Why the probe is a WebSocket handshake, not an HTTP status
 *
 * It used to `fetch()` the relay and treat any status below 500 as healthy.
 * That is why the dead Heroku seeds survived: a deleted Heroku app still
 * answers `404` with an HTML page, which counted as healthy, so the probe
 * could never evict it. A Gun relay is only a relay if it accepts the
 * WebSocket upgrade and speaks the wire protocol, so that is what is probed.
 * Gun greets every socket with a `{"dam":"?","pid":…}` frame; a plain HTTP
 * server cannot produce one.
 */

import { storage } from '../storage/mmkv';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

const HEALTHY_KEY = 'gun:relayHealth';
const HEALTHY_AT_KEY = 'gun:relayHealthAt';
export const RELAY_HEALTH_TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4_000;

/** Minimal surface of the global WebSocket the probe needs (Hermes / RN). */
export interface ProbeSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type ProbeSocketFactory = (url: string) => ProbeSocket;

/**
 * Pick the relay set to hand to Gun.
 *
 * Pure on purpose: the ordering rules are the interesting part and they are
 * exercised without touching MMKV or the network.
 */
export function selectRelayPeers(input: {
  env?: string | null;
  cachedHealthy?: readonly string[];
  seeds: readonly string[];
}): string[] {
  const fromEnv = (input.env ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (fromEnv.length > 0) return fromEnv;

  const healthy = (input.cachedHealthy ?? []).filter((value) => value.trim().length > 0);
  if (healthy.length > 0) return [...healthy];

  return [...input.seeds];
}

/**
 * Normalise a relay URL to the scheme Gun's WebSocket transport needs.
 *
 * Seeds and `EXPO_PUBLIC_GUN_RELAYS` have historically been written as
 * `https://host/gun`; both spellings are accepted so an existing override does
 * not silently stop working.
 */
export function toWebSocketUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  return trimmed;
}

/**
 * Probe one relay by completing a Gun handshake.
 *
 * Healthy means: the upgrade succeeded *and* the relay produced a wire frame.
 * On open we also send a harmless `get` for a random key, so a relay that
 * waits for the client to speak before greeting still answers. Anything that
 * cannot do that — a 404 HTML page, a parked domain, a plain web server — is
 * not a relay and must not be kept in the working set.
 */
export async function probeRelay(
  url: string,
  opts?: { timeoutMs?: number; socketFactory?: ProbeSocketFactory },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? PROBE_TIMEOUT_MS;
  const create = opts?.socketFactory ?? defaultSocketFactory;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: ProbeSocket | null = null;

    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      resolve(healthy);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      socket = create(toWebSocketUrl(url));
    } catch {
      finish(false);
      return;
    }

    socket.onopen = () => {
      try {
        // Gun's own greeting is the `dam` frame; this `get` is the fallback for
        // relays that stay quiet until the client sends something.
        socket?.send(
          JSON.stringify({ '#': 'polaris-health-probe', get: { 'polaris-probe': { '#': 'x' } } }),
        );
      } catch {
        finish(false);
      }
    };
    socket.onmessage = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

/**
 * The global WebSocket, when the runtime provides one.
 *
 * Hermes and Jest differ here, so the probe degrades to "unhealthy" rather
 * than throwing when there is no WebSocket at all.
 */
function defaultSocketFactory(url: string): ProbeSocket {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => ProbeSocket }).WebSocket;
  if (!Ctor) throw new Error('WebSocket is not available in this runtime');
  return new Ctor(url);
}

/** Probe every candidate concurrently, preserving input order in the result. */
export async function probeRelays(
  relays: readonly string[],
  opts?: { timeoutMs?: number; socketFactory?: ProbeSocketFactory },
): Promise<string[]> {
  const results = await Promise.all(
    relays.map(async (relay) => ((await probeRelay(relay, opts)) ? relay : null)),
  );
  return results.filter((relay): relay is string => relay !== null);
}

function readCache(): { healthy: string[]; at: number } {
  try {
    const raw = storage.getString(HEALTHY_KEY);
    const at = Number(storage.getString(HEALTHY_AT_KEY) ?? '0');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const healthy = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
    return { healthy, at: Number.isFinite(at) ? at : 0 };
  } catch {
    return { healthy: [], at: 0 };
  }
}

function writeCache(healthy: readonly string[], at: number): void {
  try {
    storage.set(HEALTHY_KEY, JSON.stringify(healthy));
    storage.set(HEALTHY_AT_KEY, String(at));
  } catch {
    // Cache failures are non-fatal.
  }
}

/** Relays this device last saw working (may be empty). */
export function getCachedHealthyRelays(): string[] {
  return readCache().healthy;
}

export function isRelayHealthStale(now = Date.now()): boolean {
  const { at } = readCache();
  return at === 0 || now - at > RELAY_HEALTH_TTL_MS;
}

/**
 * Probe the given relays and cache the survivors.
 *
 * Returns the healthy list (possibly empty — which is a real signal: the whole
 * seed list is unreachable, usually because the device is offline).
 */
export async function primeRelayHealth(
  relays: readonly string[],
  deps?: {
    now?: () => number;
    probe?: (relays: readonly string[]) => Promise<string[]>;
  },
): Promise<string[]> {
  const now = deps?.now ?? Date.now;
  const probe = deps?.probe ?? ((candidates: readonly string[]) => probeRelays(candidates));
  const healthy = await probe(relays);
  writeCache(healthy, now());

  if (healthy.length === 0) {
    logDiagnostic('gun', 'warn', 'no gun relay answered the health probe', {
      candidates: relays.length,
    });
  } else if (healthy.length < relays.length) {
    logDiagnostic('gun', 'info', 'dropped unhealthy gun relays', {
      healthy: healthy.length,
      candidates: relays.length,
    });
  }

  return healthy;
}

/**
 * The relay set Gun should use on this launch.
 *
 * Reads the cached healthy list (no network); probing is a separate background
 * step so Gun's constructor never waits on a relay that may be dead.
 */
export function resolveRelayPeers(seeds: readonly string[]): string[] {
  const env = process.env.EXPO_PUBLIC_GUN_RELAYS ?? null;
  if (env && env.trim().length > 0) {
    return selectRelayPeers({ env, seeds });
  }
  return selectRelayPeers({ cachedHealthy: getCachedHealthyRelays(), seeds });
}

/** Exposed for testing only. */
export function __clearRelayHealthForTests(): void {
  try {
    storage.delete(HEALTHY_KEY);
    storage.delete(HEALTHY_AT_KEY);
  } catch {
    // ignore
  }
}
