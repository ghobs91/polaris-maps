/**
 * Shared Overpass API client with parallel hedged requests.
 *
 * Sends the query to all known Overpass instances simultaneously and
 * resolves with whichever responds first (via `Promise.any`).
 */

const OVERPASS_INSTANCES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

/** Minimum gap between successive Overpass requests (ms). */
const OVERPASS_MIN_INTERVAL_MS = 1_000;
let _minIntervalMs = OVERPASS_MIN_INTERVAL_MS;
let _lastOverpassRequestAt = 0;

/** Exposed for testing only: override the inter-request throttle (0 disables). */
export function __setOverpassMinIntervalMsForTests(ms: number): void {
  _minIntervalMs = ms;
}

export interface OverpassRequestOptions {
  /** Overpass QL query string (without the `data=` prefix). */
  query: string;
  /** Client-side timeout in milliseconds. */
  timeoutMs: number;
  /** Optional AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

/**
 * Send an Overpass QL query with parallel hedging.
 *
 * Fires requests to all instances via POST (avoids URL length limits) and
 * returns the first successful response.  Throws an AggregateError if all
 * instances fail.
 */
export async function overpassFetch<T = any>(opts: OverpassRequestOptions): Promise<T> {
  // Enforce minimum inter-request gap to respect public API usage policies.
  // Clamp to 0 so a backward clock change can't produce a huge negative
  // elapsed and, in turn, an enormous wait.
  const now = Date.now();
  const elapsed = Math.max(0, now - _lastOverpassRequestAt);
  if (elapsed < _minIntervalMs) {
    await new Promise((r) => setTimeout(r, _minIntervalMs - elapsed));
  }
  _lastOverpassRequestAt = Date.now();

  const attempts = OVERPASS_INSTANCES.map(async (base) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

    // If the caller passed an external signal, abort our controller when it fires.
    const onExternalAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(opts.query)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  });

  return Promise.any(attempts);
}
