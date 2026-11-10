import { getStorageSync } from '../storage/mmkv';

/**
 * Healthy public Nostr relay directory.
 *
 * Maintains a rotating list of healthy public relays so the active set never
 * goes stale: candidate relays are probed (connect → NIP-01 REQ → EOSE
 * round-trip), ranked by latency, and the last-known-good set is persisted to
 * MMKV so cold starts don't re-probe known-dead relays first. The whole pool
 * is re-probed on a fixed interval and whenever the cached set is too old.
 *
 * Pure ranking logic is exported separately for unit tests; the probe itself
 * uses the global WebSocket (Hermes runtime) and is exercised with a mock.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Candidate pool of public relays used to (re)build the active set. */
export const DEFAULT_RELAY_POOL = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://relay.snort.social',
  'wss://nostr.mom',
];

/** How often the pool is re-probed and the active set rebuilt. */
export const RELAY_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Per-relay probe timeout — relays slower than this are scored unhealthy. */
export const RELAY_PROBE_TIMEOUT_MS = 5_000;

/** Active relays connected at once (mirrors nostrFallback's MAX_RELAYS). */
export const MAX_ACTIVE_RELAYS = 3;

/** Env override: comma-separated relay URLs prepended to the pool. */
const RELAYS_ENV_KEY = 'EXPO_PUBLIC_NOSTR_RELAYS';

const STORAGE_KEY = 'traffic.nostr-relay-scores.v1';

// ── Types ────────────────────────────────────────────────────────────

export interface RelayScore {
  url: string;
  ok: boolean;
  /** EOSE round-trip latency in ms (0 when !ok). */
  latencyMs: number;
  /** Epoch ms of the last probe. */
  lastChecked: number;
}

// ── Pure helpers (unit tested) ───────────────────────────────────────

/**
 * Rank candidate relays by health: healthy relays first (fastest first),
 * then never-probed relays, then stale ones. Dead relays are only used
 * as a last resort, after healthy and untested candidates are exhausted.
 */
export function rankRelays(
  pool: string[],
  scores: Map<string, RelayScore>,
  limit: number,
): string[] {
  const healthy: { url: string; latencyMs: number }[] = [];
  const unknown: string[] = [];
  const dead: string[] = [];
  for (const url of pool) {
    const score = scores.get(url);
    if (!score) unknown.push(url);
    else if (score.ok) healthy.push({ url, latencyMs: score.latencyMs });
    else dead.push(url);
  }
  healthy.sort((a, b) => a.latencyMs - b.latencyMs);
  return [...healthy.map((h) => h.url), ...unknown, ...dead].slice(0, limit);
}

/** Build the candidate pool: env override first, then the default list, deduped. */
export function relayPoolFromEnv(env: string | undefined): string[] {
  const override = (env ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('wss://') || u.startsWith('ws://'));
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...override, ...DEFAULT_RELAY_POOL]) {
    if (!seen.has(url)) {
      seen.add(url);
      pool.push(url);
    }
  }
  return pool;
}

// ── Probe (transport) ────────────────────────────────────────────────

/**
 * Probe a single relay: connect, send a minimal NIP-01 REQ, and resolve on
 * the relay's EOSE reply (proof the relay parses and answers filters).
 * Resolves `ok: false` on timeout or error — never rejects.
 */
export function probeRelay(
  url: string,
  timeoutMs: number = RELAY_PROBE_TIMEOUT_MS,
): Promise<RelayScore> {
  return new Promise((resolve) => {
    const finish = (ok: boolean, latencyMs = 0) => {
      clearTimeout(timer);
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      } catch {
        // Already closed
      }
      resolve({ url, ok, latencyMs, lastChecked: Date.now() });
    };

    let settled = false;
    const started = Date.now();
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        finish(false);
      }
    }, timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve({ url, ok: false, latencyMs: 0, lastChecked: Date.now() });
      return;
    }

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(['REQ', 'probe', { kinds: [1], limit: 1 }]));
      } catch {
        if (!settled) {
          settled = true;
          finish(false);
        }
      }
    };
    ws.onmessage = (event: { data: string }) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data) as unknown[];
        // ["EOSE", <subid>] means the relay answered our filter
        if (msg[0] === 'EOSE') {
          settled = true;
          finish(true, Date.now() - started);
        }
      } catch {
        // Ignore malformed messages; timeout still applies
      }
    };
    ws.onerror = () => {
      if (!settled) {
        settled = true;
        finish(false);
      }
    };
    ws.onclose = () => {
      if (!settled) {
        settled = true;
        finish(false);
      }
    };
  });
}

// ── Directory state ──────────────────────────────────────────────────

let cachedScores = new Map<string, RelayScore>();
let lastRefreshAt = 0;
let refreshInFlight: Promise<string[]> | null = null;

function loadCachedScores(): void {
  try {
    const raw = getStorageSync().getString(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as RelayScore[];
    cachedScores = new Map(parsed.map((s) => [s.url, s]));
  } catch {
    // Storage not initialized or cache corrupt — start fresh
  }
}

function persistScores(): void {
  try {
    getStorageSync().set(STORAGE_KEY, JSON.stringify(Array.from(cachedScores.values())));
  } catch {
    // Storage unavailable — keep in-memory scores only
  }
}

/**
 * Probe any candidates that are unknown or stale, merge the results into
 * the score cache, persist it, and return the new active relay list.
 * Concurrent callers share one refresh.
 */
export async function refreshRelayDirectory(
  opts: {
    pool?: string[];
    limit?: number;
    probe?: (url: string) => Promise<RelayScore>;
    now?: number;
  } = {},
): Promise<string[]> {
  const now = opts.now ?? Date.now();
  if (refreshInFlight) return refreshInFlight;
  lastRefreshAt = now;

  const pool = opts.pool ?? relayPoolFromEnv(process.env[RELAYS_ENV_KEY]);
  const limit = opts.limit ?? MAX_ACTIVE_RELAYS;
  const probe = opts.probe ?? ((url: string) => probeRelay(url));

  refreshInFlight = (async () => {
    const stale = pool.filter((url) => {
      const score = cachedScores.get(url);
      return !score || now - score.lastChecked >= RELAY_REFRESH_MS;
    });
    if (stale.length > 0) {
      const results = await Promise.all(stale.map((url) => probe(url)));
      for (const score of results) cachedScores.set(score.url, score);
      persistScores();
    }
    return rankRelays(pool, cachedScores, limit);
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Return the current active relay URLs, refreshing the directory when the
 * cache is empty or older than the refresh interval.
 */
export async function getActiveRelays(
  opts: {
    pool?: string[];
    limit?: number;
    probe?: (url: string) => Promise<RelayScore>;
    now?: number;
  } = {},
): Promise<string[]> {
  if (cachedScores.size === 0) loadCachedScores();
  const now = opts.now ?? Date.now();
  const pool = opts.pool ?? relayPoolFromEnv(process.env[RELAYS_ENV_KEY]);
  const limit = opts.limit ?? MAX_ACTIVE_RELAYS;

  const fresh = lastRefreshAt > 0 && now - lastRefreshAt < RELAY_REFRESH_MS;
  if (fresh) return rankRelays(pool, cachedScores, limit);
  return refreshRelayDirectory({ ...opts, pool, limit, now });
}

/** Test/teardown hook: reset all in-memory directory state. */
export function resetRelayDirectory(): void {
  cachedScores = new Map();
  lastRefreshAt = 0;
  refreshInFlight = null;
}
