/**
 * Anti-thrash clock for faster-route suggestions, held in its own import-free
 * module so the CarPlay manager (which must not pull the tracking/native chain
 * into its test and module graph) can dismiss a suggestion without importing
 * the whole reroute service.
 */

import { isRerouteCoolingDown, REROUTE_COOLDOWN_MS } from './reroutePolicy';

let lastDismissedAt = 0;

/** Start the anti-thrash cooldown after the user dismisses or ignores a suggestion. */
export function noteFasterRouteDismissed(now: number = Date.now()): void {
  lastDismissedAt = now;
}

/** True while a dismissed/expired suggestion is still inside the cooldown window. */
export function isSuggestionCoolingDown(
  now: number = Date.now(),
  cooldownMs: number = REROUTE_COOLDOWN_MS,
): boolean {
  return isRerouteCoolingDown(now, lastDismissedAt, cooldownMs);
}

/** Reset the cooldown clock (the monitor stopped). */
export function resetSuggestionCooldown(): void {
  lastDismissedAt = 0;
}
