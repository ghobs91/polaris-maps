/**
 * Shared Overpass API client with parallel hedged requests.
 *
 * Sends the query to all known Overpass instances simultaneously and
 * resolves with whichever responds first (via `Promise.any`).
 */

import { abortError, sleepWithAbort } from './search/abortUtils';

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
    // Abort-aware: a superseded keystroke must not sit out the throttle gap
    // and then fire a request whose results are already stale.
    await sleepWithAbort(_minIntervalMs - elapsed, opts.signal);
  }
  _lastOverpassRequestAt = Date.now();

  // Hedged requests: the first response wins and the rest are cancelled.
  // Without the cancel the losing instances keep streaming full payloads for a
  // query that is already answered — three times the bandwidth and battery per
  // search, and needless load on the public instances.
  const controllers: AbortController[] = [];
  const attempts = OVERPASS_INSTANCES.map(
    (base) =>
      new Promise<T>((resolve, reject) => {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

        // If the caller passed an external signal, abort our controller when it fires.
        const onExternalAbort = () => ctrl.abort();
        opts.signal?.addEventListener('abort', onExternalAbort);

        const cleanup = () => {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', onExternalAbort);
        };

        fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(opts.query)}`,
          signal: ctrl.signal,
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<T>;
          })
          .then(
            (value) => {
              cleanup();
              resolve(value);
            },
            (err) => {
              cleanup();
              reject(err);
            },
          );
      }),
  );

  try {
    const winner = await Promise.any(attempts);
    // The winner already settled, so aborting it is a no-op; this only stops
    // the hedge requests that are still downloading.
    controllers.forEach((ctrl) => ctrl.abort());
    return winner;
  } catch (err) {
    // `Promise.any` reports an aborted caller as an AggregateError, which
    // `isAbortError` cannot recognise — that made a superseded search look like
    // a failed one, and CarPlay answered it by blanking the driver's list.
    if (opts.signal?.aborted) throw abortError();
    throw err;
  }
}
