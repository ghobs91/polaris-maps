/**
 * Nominatim fallback gate.
 *
 * OSMF's Nominatim usage policy allows an *absolute maximum of one request per
 * second per application* — explicitly the sum of every end user's traffic, not
 * one per device — forbids client-side autocomplete against it, and requires
 * that an app be able to switch the service off without a software update.
 *
 * A shipped address-search fallback cannot stay inside that ceiling once the app
 * has a real user base: at 200k daily users, one request per second is 0.43
 * lookups per user per day for the *whole* app. The local unified index
 * (`services/search/searchIndex`) answers addresses from downloaded packs, so
 * the network fallback is not load-bearing. It is therefore **off by default**
 * and only reachable when:
 *
 *   - the build sets `EXPO_PUBLIC_NOMINATIM_FALLBACK=1` (dev / explicit opt-in), or
 *   - a signed remote config sets `nominatimFallback: true`.
 *
 * That inverts the usual kill-switch default: unreachable config, a cold install
 * and an expired signature all leave the fallback off, which is the failure mode
 * third-party infrastructure needs.
 *
 * Deliberately free of heavy imports: `config/remoteConfig` applies the flag on
 * every launch and must not drag SQLite or the database layer into the boot path.
 */

/** Build-time opt-in. Anything other than `1` leaves the fallback disabled. */
export const NOMINATIM_ENV_ENABLED: boolean = process.env.EXPO_PUBLIC_NOMINATIM_FALLBACK === '1';

let _enabled = NOMINATIM_ENV_ENABLED;

/**
 * Apply the signed remote flag. The build-time opt-in wins: a developer who set
 * `EXPO_PUBLIC_NOMINATIM_FALLBACK=1` keeps the fallback even when a published
 * config predates the flag.
 */
export function setNominatimEnabled(remoteEnabled: boolean): void {
  _enabled = remoteEnabled || NOMINATIM_ENV_ENABLED;
}

/** True when the network fallback may be used at all. */
export function isNominatimEnabled(): boolean {
  return _enabled;
}

/** Test-only: restore the build-time default. */
export function __resetNominatimPolicyForTests(): void {
  _enabled = NOMINATIM_ENV_ENABLED;
}
