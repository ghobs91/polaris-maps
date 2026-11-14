/**
 * Access control for the optional TomTom cold-start bridge.
 *
 * The bridge is not the primary traffic source: the cascade only reaches it
 * for cells that local history, P2P peers, and open feeds could not resolve.
 * These guards keep a bad day (quota exhausted, key abused, API outage) from
 * turning into a request storm:
 *
 *   - a per-session request budget caps runaway loops;
 *   - HTTP 403/429 opens a 30-minute breaker (quota exhausted / key blocked);
 *   - repeated 5xx/network failures open a 10-minute breaker;
 *   - a signed remote `tomtomBridge` flag disables it entirely.
 *
 * The key itself is inlined into the bundle (`EXPO_PUBLIC_*`) and is therefore
 * extractable. Caching and these guards reduce normal load; they cannot make
 * an embedded commercial key confidential. See the traffic README.
 */

import { tomtomApiKey } from '../../constants/config';
import { isFeatureEnabled } from '../config/remoteConfig';
import { logDiagnostic } from '../diagnostics/diagnosticsLog';

/** Maximum TomTom requests one app session may issue across every surface. */
export const TOMTOM_SESSION_REQUEST_BUDGET = 400;
/** Cooldown after HTTP 403/429 (quota exhausted or key blocked). */
export const TOMTOM_QUOTA_BLOCK_MS = 30 * 60 * 1000;
/** Cooldown after repeated transient failures. */
export const TOMTOM_FAILURE_BLOCK_MS = 10 * 60 * 1000;
/** Consecutive 5xx/network failures that open the breaker. */
export const TOMTOM_FAILURE_THRESHOLD = 5;

let requestsUsed = 0;
let blockedUntil = 0;
let consecutiveFailures = 0;

/** True when a key is configured and the remote kill switch allows the bridge. */
export function isTomTomConfigured(): boolean {
  return tomtomApiKey.length > 0 && isFeatureEnabled('tomtomBridge');
}

/** True when a request may be issued right now (key, budget, breaker). */
export function canCallTomTom(now: number = Date.now()): boolean {
  if (!isTomTomConfigured()) return false;
  if (requestsUsed >= TOMTOM_SESSION_REQUEST_BUDGET) return false;
  return now >= blockedUntil;
}

/** Account for a request about to be issued. Call only when canCall is true. */
export function noteTomTomRequest(): void {
  requestsUsed++;
}

function openBreaker(durationMs: number, reason: string, now: number): void {
  const until = now + durationMs;
  if (until > blockedUntil) {
    blockedUntil = until;
    logDiagnostic('tomtom', 'warn', `bridge paused: ${reason}`, {
      cooldownMinutes: Math.round(durationMs / 60_000),
    });
  }
}

/** Feed an HTTP status back into the breaker. */
export function noteTomTomResponse(status: number, now: number = Date.now()): void {
  if (status === 403 || status === 429) {
    consecutiveFailures = 0;
    openBreaker(TOMTOM_QUOTA_BLOCK_MS, `HTTP ${status}`, now);
    return;
  }
  if (status >= 500) {
    consecutiveFailures++;
    if (consecutiveFailures >= TOMTOM_FAILURE_THRESHOLD) {
      consecutiveFailures = 0;
      openBreaker(TOMTOM_FAILURE_BLOCK_MS, `HTTP ${status}`, now);
    }
    return;
  }
  if (status >= 200 && status < 400) consecutiveFailures = 0;
}

/** Feed a network/parse failure back into the breaker. */
export function noteTomTomNetworkError(now: number = Date.now()): void {
  consecutiveFailures++;
  if (consecutiveFailures >= TOMTOM_FAILURE_THRESHOLD) {
    consecutiveFailures = 0;
    openBreaker(TOMTOM_FAILURE_BLOCK_MS, 'network errors', now);
  }
}

/** Test-only: reset budget and breaker state. */
export function __resetTomTomAccessForTests(): void {
  requestsUsed = 0;
  blockedUntil = 0;
  consecutiveFailures = 0;
}
