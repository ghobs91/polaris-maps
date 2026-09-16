/** Pure reroute policy — timing and improvement thresholds, kept import-free for testing. */

export const CONGESTION_CHECK_INTERVAL_MS = 30_000;
/** Replacement tolerance: a reroute is adopted while its duration stays below the current duration times this factor. */
export const SIGNIFICANT_DELAY_FACTOR = 1.25;
export const REROUTE_COOLDOWN_MS = 120_000;

/** True while a reroute is still inside the anti-thrash cooldown window. */
export function isRerouteCoolingDown(
  now: number,
  lastRerouteAt: number,
  cooldownMs: number = REROUTE_COOLDOWN_MS,
): boolean {
  if (lastRerouteAt <= 0) return false;
  return now - lastRerouteAt < cooldownMs;
}

/** True when the replacement route's duration is within the tolerance band. */
export function isReplacementRouteAcceptable(
  newDurationSeconds: number,
  currentDurationSeconds: number,
  factor: number = SIGNIFICANT_DELAY_FACTOR,
): boolean {
  return newDurationSeconds < currentDurationSeconds * factor;
}
