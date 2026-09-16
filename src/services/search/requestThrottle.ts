/**
 * Shared request throttles for public geocoding APIs.
 *
 * Nominatim's usage policy requires at most one request per second across
 * the whole app. Keeping a single throttle instance shared by every call
 * site (address geocoding and category fallback) prevents accidental bursts.
 * The wait is abort-aware so a superseded keystroke does not hold the
 * throttle budget.
 */

import { sleepWithAbort, throwIfAborted } from './abortUtils';

export const NOMINATIM_MIN_INTERVAL_MS = 1_000;

export interface RequestThrottle {
  /** Wait until the minimum interval has elapsed since the last request. */
  wait(signal?: AbortSignal | null): Promise<void>;
  /** Reset the last-request timestamp (tests). */
  reset(): void;
}

export function createRequestThrottle(minIntervalMs: number): RequestThrottle {
  let lastRequestAt = 0;
  return {
    async wait(signal?: AbortSignal | null): Promise<void> {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < minIntervalMs) {
        await sleepWithAbort(minIntervalMs - elapsed, signal);
      }
      throwIfAborted(signal);
      lastRequestAt = Date.now();
    },
    reset(): void {
      lastRequestAt = 0;
    },
  };
}

/** App-wide Nominatim throttle (1 request/second). */
export const nominatimThrottle = createRequestThrottle(NOMINATIM_MIN_INTERVAL_MS);
