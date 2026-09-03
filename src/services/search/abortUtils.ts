/**
 * AbortSignal helpers for cancellable search.
 *
 * Keystroke-driven search fires a new query every few hundred ms. Without
 * cancellation, stale queries keep consuming the Nominatim/Overpass throttle
 * budgets and CPU long after their results would be discarded. Every search
 * source accepts an AbortSignal and aborts promptly; the orchestrator throws
 * AbortError so callers can tell "superseded" apart from "failed".
 */

/** Create an Error with name 'AbortError' (portable across RN/Hermes). */
export function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** Throw AbortError if the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw abortError();
}

/** True for AbortErrors from any source (native fetch, our helpers). */
export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * setTimeout that rejects with AbortError if the signal fires first.
 * Used for the Nominatim/Overpass throttle gaps so a stale search doesn't
 * block the throttle budget for up to a second.
 */
export async function sleepWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Combine an external AbortSignal with a timeout. The returned signal aborts
 * when either the outer signal fires or the timeout elapses. Call `cleanup`
 * to clear the timer and listener once the fetch settles.
 */
export function withTimeout(
  outer: AbortSignal | undefined | null,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const inner = new AbortController();
  if (outer?.aborted) inner.abort();
  const timer = setTimeout(() => inner.abort(), timeoutMs);
  const onAbort = () => inner.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: inner.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}
