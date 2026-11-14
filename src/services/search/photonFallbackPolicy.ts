/**
 * Gate for the Photon (komoot) text-search fallback.
 *
 * Photon is a free public instance operated by komoot, a commercial company.
 * It publishes no request quota and no usage policy, which is a different risk
 * from Nominatim (OSMF: one request per second for the whole application) or
 * Transitous (720 `/plan` calls per 24h for the whole application): there is no
 * published ceiling to violate, only goodwill to spend.
 *
 * So this tier is **rationed rather than disabled**. It stays available by
 * default because a maps app with no remote geocoder cannot resolve an address
 * outside a downloaded region, and the mitigation that fits the risk is a hard
 * per-device allowance (`photonFallbackBudget`), not an outage.
 *
 * It is also already fallback-only: `unifiedSearch` only calls it when the
 * unified local index produced no strong match, so a covered area never reaches
 * it at all.
 *
 * Publishing `photonFallback: false` in the signed config turns it off entirely
 * without an App Store release — that is the switch that matters if komoot ever
 * asks us to stop.
 *
 * Deliberately free of heavy imports: `config/remoteConfig` applies the flag on
 * every launch and must not drag storage or the network layer into boot.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Build-time opt-out. Set to `0` to disable the fallback in a build. */
export const PHOTON_FALLBACK_ENV_ENABLED: boolean = process.env.EXPO_PUBLIC_PHOTON_FALLBACK !== '0';

/**
 * Photon queries one device may spend per UTC day.
 *
 * A search is user-initiated and the local index absorbs most of them, so this
 * is generous for a real session while still bounding a device that gets stuck
 * in a retry loop. Fifty devices' worth of allowance is a rounding error for a
 * public instance; fifty thousand is not, which is the point.
 */
export const PHOTON_FALLBACK_BUDGET_PER_DAY = 50;

// ── Policy state ─────────────────────────────────────────────────────

let _remoteEnabled = true;

/** Apply the signed remote flag. The build-time opt-out always wins. */
export function setPhotonFallbackEnabled(remoteEnabled: boolean): void {
  _remoteEnabled = remoteEnabled !== false;
}

/** True when the tier may be used at all (build opt-out not set, config allows). */
export function isPhotonFallbackEnabled(): boolean {
  return PHOTON_FALLBACK_ENV_ENABLED && _remoteEnabled;
}

/** Test-only: restore defaults. */
export function __resetPhotonFallbackPolicyForTests(): void {
  _remoteEnabled = true;
}
