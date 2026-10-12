/** Pure reroute policy — timing and improvement thresholds, kept import-free for testing. */

export const CONGESTION_CHECK_INTERVAL_MS = 30_000;
/**
 * Longest the monitor may go between candidate comparisons when no congestion
 * is detected ahead. Keeps the deviation case covered without routing requests
 * on every tick.
 */
export const FULL_ROUTE_COMPARE_INTERVAL_MS = 120_000;
/** Anti-thrash window between faster-route suggestions (also the dismiss cooldown). */
export const REROUTE_COOLDOWN_MS = 120_000;
/** How long a faster-route suggestion stays on screen before auto-dismissing. */
export const SUGGESTION_TIMEOUT_MS = 20_000;
/** Minimum time a candidate route must save before it is worth suggesting. */
export const MIN_FASTER_ROUTE_SAVING_SECONDS = 120;

/** True while a suggestion/attempt is still inside the anti-thrash cooldown window. */
export function isRerouteCoolingDown(
  now: number,
  lastRerouteAt: number,
  cooldownMs: number = REROUTE_COOLDOWN_MS,
): boolean {
  if (lastRerouteAt <= 0) return false;
  return now - lastRerouteAt < cooldownMs;
}

/**
 * True when a candidate route saves at least `minSavingSeconds` versus the
 * current route's remaining duration. A non-positive current duration cannot be
 * improved on, so it never qualifies.
 */
export function isSignificantlyFasterRoute(
  candidateDurationSeconds: number,
  currentDurationSeconds: number,
  minSavingSeconds: number = MIN_FASTER_ROUTE_SAVING_SECONDS,
): boolean {
  if (currentDurationSeconds <= 0) return false;
  return currentDurationSeconds - candidateDurationSeconds >= minSavingSeconds;
}
