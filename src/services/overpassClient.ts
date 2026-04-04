/**
 * Shared Overpass API client with automatic failover.
 *
 * Primary:   https://overpass.private.coffee/api/interpreter
 * Fallback:  https://overpass-api.de/api/interpreter
 *
 * On a network error or non-OK HTTP status from the primary, the request
 * is retried once against the fallback instance before propagating the error.
 */

const OVERPASS_PRIMARY = 'https://overpass.private.coffee/api/interpreter';
const OVERPASS_FALLBACK = 'https://overpass-api.de/api/interpreter';

export interface OverpassRequestOptions {
  /** Overpass QL query string (without the `data=` prefix). */
  query: string;
  /** Client-side timeout in milliseconds. */
  timeoutMs: number;
  /** Optional AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

/**
 * Send an Overpass QL query with automatic failover.
 *
 * Returns the parsed JSON response body. Throws on failure from *both*
 * instances.
 */
export async function overpassFetch<T = any>(opts: OverpassRequestOptions): Promise<T> {
  const urls = [OVERPASS_PRIMARY, OVERPASS_FALLBACK];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLast = i === urls.length - 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    // If the caller passed an external signal, abort our controller when it fires.
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(opts.query)}`,
        signal: controller.signal,
      });

      if (!res.ok) {
        if (isLast) throw new Error(`Overpass API ${res.status}`);
        // Try fallback
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      // If the *caller* aborted, don't retry — propagate immediately.
      if (opts.signal?.aborted) throw err;
      if (isLast) throw err;
      // Network / timeout error on primary — try fallback
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // Unreachable, but TypeScript wants a return.
  throw new Error('Overpass API: all instances failed');
}
