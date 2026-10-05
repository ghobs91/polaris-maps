/**
 * Paced, serialized on-device browsing scheduler.
 *
 * Bounded policy (see the `headless-browse-policy` spec):
 *  - at most one browse runs at a time, globally;
 *  - per host, a minimum interval with random jitter between requests;
 *  - a challenge sets a per-host cool-down with exponential backoff;
 *  - an HTTP 429 / `Retry-After` extends the cool-down.
 *
 * Explicitly NOT provided: CAPTCHA solving, proxy/IP rotation, fingerprint
 * spoofing, auth-wall bypass, or bulk harvesting. The app behaves like a single
 * user browsing one listing at a time and gives up silently when challenged.
 */

export interface BrowseSchedulerOptions {
  /** Minimum spacing between requests to the same host. */
  minIntervalMs?: number;
  /** Extra uniform random jitter (0..jitterMs) added on top of the minimum. */
  jitterMs?: number;
  /** First challenge cool-down; doubles per subsequent challenge. */
  cooldownBaseMs?: number;
  /** Cap on the exponential challenge cool-down. */
  cooldownMaxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface BrowseScheduler {
  /** Run `task` for `host`, serialized and paced. Never rejects due to pacing. */
  schedule<T>(host: string, task: () => Promise<T>): Promise<T>;
  /** True while `host` is serving a challenge/rate-limit cool-down. */
  isCoolingDown(host: string): boolean;
  /** Remaining cool-down for `host`, in ms (0 when not cooling down). */
  cooldownRemainingMs(host: string): number;
  /** Record an anti-bot challenge; escalates the host's cool-down. */
  reportChallenge(host: string): void;
  /** Record an HTTP 429 / `Retry-After`; extends the host's cool-down. */
  reportRateLimited(host: string, retryAfterMs: number): void;
  /** Clear all state (tests / teardown). */
  reset(): void;
}

const DEFAULTS = {
  minIntervalMs: 3_000,
  jitterMs: 5_000,
  cooldownBaseMs: 60_000,
  cooldownMaxMs: 30 * 60_000,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBrowseScheduler(options: BrowseSchedulerOptions = {}): BrowseScheduler {
  const minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const jitterMs = options.jitterMs ?? DEFAULTS.jitterMs;
  const cooldownBaseMs = options.cooldownBaseMs ?? DEFAULTS.cooldownBaseMs;
  const cooldownMaxMs = options.cooldownMaxMs ?? DEFAULTS.cooldownMaxMs;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let tail: Promise<unknown> = Promise.resolve();
  const nextAllowedAt = new Map<string, number>();
  const cooldownUntil = new Map<string, number>();
  const challengeCount = new Map<string, number>();

  function cooldownRemainingMs(host: string): number {
    return Math.max(0, (cooldownUntil.get(host) ?? 0) - now());
  }

  function schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      const wait = Math.max(cooldownRemainingMs(host), (nextAllowedAt.get(host) ?? 0) - now(), 0);
      if (wait > 0) await sleep(wait);

      nextAllowedAt.set(host, now() + minIntervalMs + Math.floor(random() * jitterMs));
      return task();
    });
    // Keep the chain alive regardless of task outcome; callers see `run`.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function reportChallenge(host: string): void {
    const count = (challengeCount.get(host) ?? 0) + 1;
    challengeCount.set(host, count);
    const cooldown = Math.min(cooldownMaxMs, cooldownBaseMs * 2 ** (count - 1));
    cooldownUntil.set(host, now() + cooldown);
  }

  function reportRateLimited(host: string, retryAfterMs: number): void {
    const cooldown = Math.max(retryAfterMs, minIntervalMs);
    cooldownUntil.set(host, Math.max(cooldownUntil.get(host) ?? 0, now() + cooldown));
  }

  function reset(): void {
    tail = Promise.resolve();
    nextAllowedAt.clear();
    cooldownUntil.clear();
    challengeCount.clear();
  }

  return {
    schedule,
    isCoolingDown: (host) => cooldownRemainingMs(host) > 0,
    cooldownRemainingMs,
    reportChallenge,
    reportRateLimited,
    reset,
  };
}

/** Shared scheduler instance used by the ratings controller. */
export const browseScheduler = createBrowseScheduler();
