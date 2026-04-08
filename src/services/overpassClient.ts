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
 * Fires requests to all instances and returns the first successful response.
 * Throws an AggregateError if all instances fail.
 */
export async function overpassFetch<T = any>(opts: OverpassRequestOptions): Promise<T> {
  const encoded = encodeURIComponent(opts.query);

  const attempts = OVERPASS_INSTANCES.map(async (base) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

    // If the caller passed an external signal, abort our controller when it fires.
    const onExternalAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(`${base}?data=${encoded}`, {
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
