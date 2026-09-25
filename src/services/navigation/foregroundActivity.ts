/**
 * Whether the navigation screen's display-driven interpolation loop is
 * actually ticking.
 *
 * The loop uses `requestAnimationFrame`, so it stops the moment the phone
 * display sleeps. `AppState` cannot tell us that: while CarPlay is attached
 * the app stays `active` (the CarPlay scene keeps the process foreground)
 * even with the phone screen locked, so gating background publishing on
 * `AppState` froze the CarPlay map at the lock-time position.
 *
 * Kept dependency-free (no native-module imports) so headless paths and unit
 * tests can import it without pulling in `expo-haptics`/`expo-location`.
 */

let lastTickAt = 0;
/** Age after which the interpolation loop is considered stopped. */
const FRESH_MS = 1200;

/** Called by the navigation screen's interpolation loop on every frame. */
export function markForegroundInterpolationTick(): void {
  lastTickAt = Date.now();
}

/**
 * True while the interpolation loop is ticking (phone display on, screen
 * mounted) — i.e. while it owns the published live position/bearing/countdown.
 */
export function isForegroundInterpolationActive(): boolean {
  const age = Date.now() - lastTickAt;
  // Negative age (wall clock jumped backwards) also counts as not ticking so
  // a stale loop can never suppress publishing indefinitely.
  return age >= 0 && age < FRESH_MS;
}

/** Test-only: reset the heartbeat. */
export function resetForegroundInterpolationHeartbeat(): void {
  lastTickAt = 0;
}
