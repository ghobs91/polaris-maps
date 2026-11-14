/**
 * Gate for the Transitous `/plan` routing tier.
 *
 * Transitous is a community MOTIS instance, and its published usage policy puts
 * a hard number on journey planning:
 *
 *   "Many requests (> 720 requests / 24h) of type /plan, /one-to-many,
 *    /one-to-all, many users and automated requests are the primary source of
 *    high resource usage on our side. Please coordinate with us if your use case
 *    requires any of this."
 *
 * 720 per day is the *whole application's* allowance, not one per device. At
 * 10 plans per device per day that is 72 daily users before the ceiling is
 * reached, which is why this tier is **off by default**: a shipped default-on
 * router cannot stay inside that budget once the app has a real user base.
 *
 * The tier is therefore only reachable when:
 *
 *   - the build sets `EXPO_PUBLIC_TRANSITOUS_PLAN=1` (dev / explicit opt-in), or
 *   - a signed remote config sets `transitousPlan: true`.
 *
 * and the device still has budget left for the UTC day. This inverts the usual
 * kill-switch default, exactly like `geocoding/nominatimPolicy`: an unreachable
 * config, a cold install and an expired signature all leave the tier off, which
 * is the failure mode volunteer infrastructure needs.
 *
 * Deliberately free of heavy imports — `config/remoteConfig` applies the flag on
 * every launch and must not drag storage, SQLite or the network layer into the
 * boot path. The per-device rationing lives in `transitousPlanBudget`.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Build-time opt-in. Anything other than `1` leaves the tier disabled. */
export const TRANSITOUS_PLAN_ENV_ENABLED: boolean = process.env.EXPO_PUBLIC_TRANSITOUS_PLAN === '1';

/**
 * Journey plans one device may spend per UTC day.
 *
 * Sized so that a small opt-in beta stays under the published 720/24h ceiling:
 * `TRANSITOUS_PLAN_BUDGET_PER_DAY * daily devices <= TRANSITOUS_PLAN_DAILY_CEILING`.
 */
export const TRANSITOUS_PLAN_BUDGET_PER_DAY = 10;

/** The application-wide allowance published by Transitous, for the doc comment above. */
export const TRANSITOUS_PLAN_DAILY_CEILING = 720;

// ── Policy state ─────────────────────────────────────────────────────

let _remoteEnabled = false;

/** Apply the signed remote flag. The build-time opt-in always wins. */
export function setTransitousPlanEnabled(remoteEnabled: boolean): void {
  _remoteEnabled = remoteEnabled === true;
}

/** True when the tier may be used at all (build opt-in or signed config). */
export function isTransitousPlanEnabled(): boolean {
  return TRANSITOUS_PLAN_ENV_ENABLED || _remoteEnabled;
}

/** Test-only: restore defaults. */
export function __resetTransitousPlanPolicyForTests(): void {
  _remoteEnabled = false;
}
