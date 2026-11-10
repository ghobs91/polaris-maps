/**
 * Shared Overpass API client — fallback only.
 *
 * POI and transit answers normally come from the on-device indices
 * (`services/poi/localPoiIndex`, `services/transit/localTransitIndex`), which
 * are built from signed region packs. This client is the escape hatch for
 * areas with no local pack coverage, and it is written to be a good citizen of
 * volunteer-run infrastructure:
 *
 * - **No hedging.** The previous implementation fired the same query at all
 *   three mirrors simultaneously and took the first reply. That is ~3x the
 *   load on other people's servers for every search — precisely what melts
 *   `overpass-api.de` when an app gets a traffic spike. Mirrors are now tried
 *   sequentially, in order, and only when the previous one failed.
 * - **Cooldowns.** A mirror that rate-limits (429), 5xx's, times out, or is
 *   unreachable enters exponential cooldown and is skipped entirely until it
 *   expires. One bad query cannot turn into a request storm.
 * - **One request in flight, app-wide.** Requests are serialised, so a burst
 *   of viewport settles cannot exceed one concurrent connection.
 * - **Identifiable.** Every request carries an app-specific `User-Agent` so
 *   mirror operators can contact us instead of blocking us silently.
 * - **Remote kill switch.** `setOverpassEnabled(false)` (wired to the signed
 *   remote config flag `overpassQuery`) turns the fallback off without a
 *   release.
 */

import { abortError, isAbortError, sleepWithAbort, throwIfAborted } from './search/abortUtils';
import { logDiagnostic } from './diagnostics/diagnosticsLog';

/** Public mirrors, tried in this order. Primary (DE) first. */
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
] as const;

/**
 * Identifying User-Agent. Public Overpass mirrors block anonymous or anonymous-
 * looking burst traffic; a stable, identifiable UA is how an operator tells the
 * app apart from a scraper. The URL is the project site only — no service, no
 * endpoint, nothing that has to stay up for the app to work.
 */
export const OVERPASS_USER_AGENT =
  'PolarisMaps/0.1 (+https://app.polarismaps.app; OSM fallback client)';

/** Minimum gap between successive Overpass requests (ms). */
const OVERPASS_MIN_INTERVAL_MS = 1_000;
/** Cooldown after a 429/5xx: the mirror is telling us to go away. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
/** Cooldown after a network error/timeout. */
const FAILURE_COOLDOWN_MS = 30_000;
/** Upper bound for exponential cooldowns. */
const MAX_COOLDOWN_MS = 10 * 60_000;

export interface OverpassRequestOptions {
  /** Overpass QL query string (without the `data=` prefix). */
  query: string;
  /** Client-side timeout in milliseconds. */
  timeoutMs: number;
  /** Optional AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

/** Thrown when the remote kill switch has disabled the fallback. */
export class OverpassDisabledError extends Error {
  constructor() {
    super('Overpass fallback is disabled by remote config');
    this.name = 'OverpassDisabledError';
  }
}

/** Thrown when every mirror is cooling down or failed. */
export class OverpassUnavailableError extends Error {
  /** Epoch ms at which the soonest mirror leaves cooldown, if known. */
  readonly retryAt: number | null;

  constructor(message: string, retryAt: number | null) {
    super(message);
    this.name = 'OverpassUnavailableError';
    this.retryAt = retryAt;
  }
}

/** A single mirror's health. */
interface MirrorPolicy {
  consecutiveFailures: number;
  cooldownUntil: number;
}

/** Internal error carrying the HTTP status (0 for timeout/network). */
class OverpassRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OverpassRequestError';
    this.status = status;
  }
}

let _minIntervalMs = OVERPASS_MIN_INTERVAL_MS;
let _lastRequestAt = 0;
let _enabled = true;
let _now = () => Date.now();
/** Serialises requests: at most one Overpass request in flight app-wide. */
let _serial: Promise<unknown> = Promise.resolve();
const _policies = new Map<string, MirrorPolicy>();

/** Remote kill switch. */
export function setOverpassEnabled(enabled: boolean): void {
  _enabled = enabled;
}

export function isOverpassEnabled(): boolean {
  return _enabled;
}

/** Exposed for testing only: override the inter-request throttle (0 disables). */
export function __setOverpassMinIntervalMsForTests(ms: number): void {
  _minIntervalMs = ms;
}

/** Exposed for testing only: replace the clock. */
export function __setOverpassClockForTests(now: () => number): void {
  _now = now;
}

/** Exposed for testing only: reset all mirrors, throttle and kill switch. */
export function __resetOverpassPolicyForTests(): void {
  _minIntervalMs = OVERPASS_MIN_INTERVAL_MS;
  _lastRequestAt = 0;
  _enabled = true;
  _now = () => Date.now();
  _serial = Promise.resolve();
  _policies.clear();
}

/** Exposed for testing only. */
export function __getOverpassCooldownsForTests(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mirror, policy] of _policies) out[mirror] = policy.cooldownUntil;
  return out;
}

function policyFor(mirror: string): MirrorPolicy {
  const existing = _policies.get(mirror);
  if (existing) return existing;
  const created: MirrorPolicy = { consecutiveFailures: 0, cooldownUntil: 0 };
  _policies.set(mirror, created);
  return created;
}

function hostOfUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
}

async function throttle(signal?: AbortSignal): Promise<void> {
  const elapsed = Math.max(0, _now() - _lastRequestAt);
  if (elapsed < _minIntervalMs) {
    await sleepWithAbort(_minIntervalMs - elapsed, signal);
  }
  _lastRequestAt = _now();
}

async function requestFrom<T>(mirror: string, opts: OverpassRequestOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(mirror, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(opts.query)}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new OverpassRequestError(res.status, `HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    if (timedOut) throw new OverpassRequestError(0, 'timeout');
    if (err instanceof OverpassRequestError) throw err;
    // AbortError raised by the local controller for any other reason is a
    // mirror failure, not a caller abort — the caller check above already
    // handled that case.
    if (isAbortError(err)) throw new OverpassRequestError(0, 'aborted');
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Record a failure and compute the mirror's next cooldown window. */
function penalize(mirror: string, err: unknown): number {
  const policy = policyFor(mirror);
  policy.consecutiveFailures += 1;
  const status = err instanceof OverpassRequestError ? err.status : 0;
  const base = status === 429 || status >= 500 ? RATE_LIMIT_COOLDOWN_MS : FAILURE_COOLDOWN_MS;
  const backoff = base * Math.pow(2, Math.min(policy.consecutiveFailures - 1, 4));
  policy.cooldownUntil = _now() + Math.min(backoff, MAX_COOLDOWN_MS);
  return policy.cooldownUntil;
}

async function attempt<T>(opts: OverpassRequestOptions): Promise<T> {
  const failures: string[] = [];
  let earliestRetry: number | null = null;

  for (const mirror of OVERPASS_MIRRORS) {
    throwIfAborted(opts.signal);
    const policy = policyFor(mirror);
    const now = _now();
    if (policy.cooldownUntil > now) {
      failures.push(
        `${hostOfUrl(mirror)}: cooling down ${Math.ceil((policy.cooldownUntil - now) / 1000)}s`,
      );
      earliestRetry =
        earliestRetry === null
          ? policy.cooldownUntil
          : Math.min(earliestRetry, policy.cooldownUntil);
      continue;
    }

    await throttle(opts.signal);

    try {
      const value = await requestFrom<T>(mirror, opts);
      policy.consecutiveFailures = 0;
      policy.cooldownUntil = 0;
      return value;
    } catch (err) {
      // A caller abort is terminal: do not try other mirrors.
      if (isAbortError(err)) throw err;
      const until = penalize(mirror, err);
      earliestRetry = earliestRetry === null ? until : Math.min(earliestRetry, until);
      failures.push(`${hostOfUrl(mirror)}: ${err instanceof Error ? err.message : String(err)}`);
      logDiagnostic('overpass', 'warn', 'mirror failed', {
        mirror: hostOfUrl(mirror),
        error: err instanceof Error ? err.message : String(err),
        cooldownMs: until - _now(),
      });
    }
  }

  logDiagnostic('overpass', 'warn', 'no mirror answered', { failures });
  throw new OverpassUnavailableError(
    `Overpass unavailable (${failures.join('; ')})`,
    earliestRetry,
  );
}

/**
 * Send an Overpass QL query, trying mirrors in order until one answers.
 *
 * Requests are serialised app-wide and throttled to one per
 * {@link OVERPASS_MIN_INTERVAL_MS}. A mirror in cooldown is never contacted.
 * Throws {@link OverpassDisabledError} when the remote kill switch is off and
 * {@link OverpassUnavailableError} when every mirror is unavailable.
 */
export async function overpassFetch<T = any>(opts: OverpassRequestOptions): Promise<T> {
  if (!_enabled) throw new OverpassDisabledError();
  throwIfAborted(opts.signal);

  const run = _serial.then(
    () => attempt<T>(opts),
    () => attempt<T>(opts),
  );
  // Keep the chain alive regardless of the outcome, without leaking rejections.
  _serial = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
