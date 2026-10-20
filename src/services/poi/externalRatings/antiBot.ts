/**
 * Paced, serialized on-device browsing scheduler.
 *
 * Bounded policy (see the `headless-browse-policy` spec):
 *  - at most one browse runs at a time, globally;
 *  - per host, a minimum interval with random jitter between requests;
 *  - a challenge sets a per-host cool-down with exponential backoff;
 *  - an HTTP 429 / `Retry-After` extends the cool-down;
 *  - starting a *new* browsing chain (a fresh place) is token-bucketed and
 *    capped per local day, so browsing many places cannot turn into a burst of
 *    provider page loads;
 *  - challenges, blocks and the page-load budget persist across app launches.
 *
 * Explicitly NOT provided: CAPTCHA solving, proxy/IP rotation, fingerprint
 * spoofing, auth-wall bypass, or bulk harvesting. The app behaves like a single
 * user browsing one listing at a time and gives up silently when challenged.
 */

import { deleteLedgerFile, readLedgerFile, writeLedgerFile } from './ledgerFile';

export interface BrowseSchedulerOptions {
  /** Minimum spacing between requests to the same host. */
  minIntervalMs?: number;
  /** Extra uniform random jitter (0..jitterMs) added on top of the minimum. */
  jitterMs?: number;
  /** First challenge cool-down; doubles per subsequent challenge. */
  cooldownBaseMs?: number;
  /** Cap on the exponential challenge cool-down. */
  cooldownMaxMs?: number;
  /** Minimum spacing between the *first* page load of two browsing chains. */
  pageIntervalMs?: number;
  /** Extra uniform random jitter added to `pageIntervalMs`. */
  pageJitterMs?: number;
  /** Page loads allowed in a burst before the bucket refills one at a time. */
  pageBurst?: number;
  /** One page-load token is restored per this interval. */
  pageRefillMs?: number;
  /** Hard ceiling on provider page loads per local day, per host. */
  pageDailyCap?: number;
  /** Longest a caller will wait for the next page slot before giving up. */
  maxPageWaitMs?: number;
  /** How long a detected hard block disables the host. */
  blockMs?: number;
  /** Upper bound on waiting for persisted state before a page load. */
  hydrateTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Optional persistence; the shared scheduler uses the app documents dir. */
  persistence?: BrowsePersistence | null;
}

export type PageLoadReason = 'blocked' | 'cooldown' | 'rate' | 'daily-cap';

export interface PageLoadDecision {
  ok: boolean;
  reason?: PageLoadReason;
  /** Earliest time (ms epoch) the host may be tried again, when known. */
  retryAt?: number;
}

export interface BrowseScheduler {
  /** Run `task` for `host`, serialized and paced. Never rejects due to pacing. */
  schedule<T>(host: string, task: () => Promise<T>): Promise<T>;
  /**
   * Reserve a slot for the first page load of a new browsing chain.
   *
   * Serialized against other reservations and the fetch queue. Returns
   * `{ ok: true }` once the host is allowed to load; otherwise explains why the
   * caller must give up for now (and when it may retry).
   */
  acquirePageLoad(host: string): Promise<PageLoadDecision>;
  /** True while `host` is serving a challenge/rate-limit cool-down. */
  isCoolingDown(host: string): boolean;
  /** Remaining cool-down for `host`, in ms (0 when not cooling down). */
  cooldownRemainingMs(host: string): number;
  /** Remaining hard-block time for `host`, in ms (0 when not blocked). */
  blockedRemainingMs(host: string): number;
  /** Record an anti-bot challenge; escalates the host's cool-down. */
  reportChallenge(host: string): void;
  /** Record an HTTP 429 / `Retry-After`; extends the host's cool-down. */
  reportRateLimited(host: string, retryAfterMs: number): void;
  /** Record a hard block page; disables the host for `blockMs`. */
  reportBlocked(host: string): void;
  /** Load persisted state. Safe to call repeatedly; resolves immediately when ready. */
  hydrate(): Promise<void>;
  /** Clear all state (tests / teardown). Also disables persistence until re-hydration. */
  reset(): void;
}

export interface PersistedHostState {
  cooldownUntil: number;
  challengeCount: number;
  blockedUntil: number;
  pageTokens: number;
  pageRefilledAt: number;
  pageLoadsToday: number;
  pageDay: string;
}

export interface PersistedLedger {
  version: 1;
  hosts: Record<string, PersistedHostState>;
}

export interface BrowsePersistence {
  load(): Promise<PersistedLedger | null>;
  save(ledger: PersistedLedger): void;
  clear(): void;
}

const LEDGER_NAME = 'browse-ledger.json';

const FILE_PERSISTENCE: BrowsePersistence = {
  load: () => readLedgerFile<PersistedLedger>(LEDGER_NAME),
  save: (ledger) => writeLedgerFile(LEDGER_NAME, ledger),
  clear: () => deleteLedgerFile(LEDGER_NAME),
};

const DEFAULTS = {
  minIntervalMs: 3_000,
  jitterMs: 5_000,
  cooldownBaseMs: 60_000,
  cooldownMaxMs: 30 * 60_000,
  // A human can open a provider page every few seconds in a burst, but does not
  // start a new place lookup every few seconds for an hour.
  pageIntervalMs: 5_000,
  pageJitterMs: 5_000,
  pageBurst: 5,
  pageRefillMs: 45_000,
  pageDailyCap: 60,
  maxPageWaitMs: 10_000,
  // Long enough to stop hammering a blocked host, short enough that switching
  // networks or waiting out a carriage-grade NAT cooldown recovers on its own.
  blockMs: 2 * 60 * 60_000,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

interface HostState {
  nextAllowedAt: number;
  cooldownUntil: number;
  challengeCount: number;
  blockedUntil: number;
  pageTokens: number;
  pageRefilledAt: number;
  pageLoadsToday: number;
  pageDay: string;
  /** Earliest time the next independent page load may start. */
  nextPageAt: number;
}

export function createBrowseScheduler(options: BrowseSchedulerOptions = {}): BrowseScheduler {
  const minIntervalMs = options.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const jitterMs = options.jitterMs ?? DEFAULTS.jitterMs;
  const cooldownBaseMs = options.cooldownBaseMs ?? DEFAULTS.cooldownBaseMs;
  const cooldownMaxMs = options.cooldownMaxMs ?? DEFAULTS.cooldownMaxMs;
  const pageIntervalMs = options.pageIntervalMs ?? DEFAULTS.pageIntervalMs;
  const pageJitterMs = options.pageJitterMs ?? DEFAULTS.pageJitterMs;
  const pageBurst = options.pageBurst ?? DEFAULTS.pageBurst;
  const pageRefillMs = options.pageRefillMs ?? DEFAULTS.pageRefillMs;
  const pageDailyCap = options.pageDailyCap ?? DEFAULTS.pageDailyCap;
  const maxPageWaitMs = options.maxPageWaitMs ?? DEFAULTS.maxPageWaitMs;
  const blockMs = options.blockMs ?? DEFAULTS.blockMs;
  const hydrateTimeoutMs = options.hydrateTimeoutMs ?? 1_500;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const persistence = options.persistence ?? null;

  let tail: Promise<unknown> = Promise.resolve();
  let pageTail: Promise<unknown> = Promise.resolve();
  const hosts = new Map<string, HostState>();

  let hydrated = false;
  let hydratePromise: Promise<void> | null = null;
  let persistEnabled = persistence != null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function newHostState(): HostState {
    const t = now();
    return {
      nextAllowedAt: 0,
      cooldownUntil: 0,
      challengeCount: 0,
      blockedUntil: 0,
      pageTokens: pageBurst,
      pageRefilledAt: t,
      pageLoadsToday: 0,
      pageDay: localDay(t),
      nextPageAt: 0,
    };
  }

  function hostState(host: string): HostState {
    let state = hosts.get(host);
    if (!state) {
      state = newHostState();
      hosts.set(host, state);
    }
    return state;
  }

  function toLedger(): PersistedLedger {
    const persisted: Record<string, PersistedHostState> = {};
    for (const [host, state] of hosts) {
      persisted[host] = {
        cooldownUntil: state.cooldownUntil,
        challengeCount: state.challengeCount,
        blockedUntil: state.blockedUntil,
        pageTokens: state.pageTokens,
        pageRefilledAt: state.pageRefilledAt,
        pageLoadsToday: state.pageLoadsToday,
        pageDay: state.pageDay,
      };
    }
    return { version: 1, hosts: persisted };
  }

  function persistNow(): void {
    if (!persistence || !persistEnabled || !hydrated) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistence.save(toLedger());
  }

  function persist(): void {
    if (!persistence || !persistEnabled || !hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 250);
  }

  function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          resolve();
        },
      );
    });
  }

  /** Persisted state can improve pacing, but must never stall a page load. */
  async function hydrateWithin(): Promise<void> {
    if (!persistence || hydrated) return hydrate();
    await withTimeout(hydrate(), hydrateTimeoutMs);
  }

  function hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve();
    if (!persistence) {
      hydrated = true;
      return Promise.resolve();
    }
    if (!hydratePromise) {
      hydratePromise = persistence
        .load()
        .then((ledger) => {
          if (ledger?.version === 1 && ledger.hosts) {
            for (const [host, saved] of Object.entries(ledger.hosts)) {
              const state = hostState(host);
              state.cooldownUntil = saved.cooldownUntil ?? 0;
              state.challengeCount = saved.challengeCount ?? 0;
              state.blockedUntil = saved.blockedUntil ?? 0;
              state.pageTokens = Math.max(0, Math.min(pageBurst, saved.pageTokens ?? pageBurst));
              state.pageRefilledAt = saved.pageRefilledAt ?? now();
              state.pageLoadsToday = saved.pageLoadsToday ?? 0;
              state.pageDay = saved.pageDay ?? localDay(now());
            }
          }
          hydrated = true;
        })
        .catch(() => {
          hydrated = true;
        });
    }
    return hydratePromise;
  }

  function cooldownRemainingMs(host: string): number {
    return Math.max(0, (hostState(host).cooldownUntil ?? 0) - now());
  }

  function blockedRemainingMs(host: string): number {
    return Math.max(0, (hostState(host).blockedUntil ?? 0) - now());
  }

  function isCoolingDown(host: string): boolean {
    return cooldownRemainingMs(host) > 0 || blockedRemainingMs(host) > 0;
  }

  function refillPageTokens(state: HostState): void {
    const t = now();
    const elapsed = Math.max(0, t - state.pageRefilledAt);
    if (elapsed < pageRefillMs) return;
    const gained = Math.floor(elapsed / pageRefillMs);
    if (gained <= 0) return;
    state.pageTokens = Math.min(pageBurst, state.pageTokens + gained);
    state.pageRefilledAt += gained * pageRefillMs;
  }

  function rolloverDay(state: HostState, t: number): void {
    const day = localDay(t);
    if (state.pageDay !== day) {
      state.pageDay = day;
      state.pageLoadsToday = 0;
    }
  }

  function schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      // A persisted challenge/block must apply before the first request of a
      // launch, not one request too late — but a slow file read must not block
      // the request forever.
      await hydrateWithin();
      const wait = Math.max(
        cooldownRemainingMs(host),
        (hostState(host).nextAllowedAt ?? 0) - now(),
        0,
      );
      if (wait > 0) await sleep(wait);

      const t = now();
      hostState(host).nextAllowedAt = t + minIntervalMs + Math.floor(random() * jitterMs);
      return task();
    });
    // Keep the chain alive regardless of task outcome; callers see `run`.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function acquirePageLoad(host: string): Promise<PageLoadDecision> {
    const run = pageTail.then(async (): Promise<PageLoadDecision> => {
      await hydrateWithin();

      const t = now();
      const state = hostState(host);
      rolloverDay(state, t);

      if (state.blockedUntil > t) {
        return { ok: false, reason: 'blocked', retryAt: state.blockedUntil };
      }
      if (state.cooldownUntil > t) {
        return { ok: false, reason: 'cooldown', retryAt: state.cooldownUntil };
      }
      if (state.pageLoadsToday >= pageDailyCap) {
        const nextDay = new Date(t);
        nextDay.setHours(24, 0, 0, 0);
        return { ok: false, reason: 'daily-cap', retryAt: nextDay.getTime() };
      }

      refillPageTokens(state);
      if (state.pageTokens < 1) {
        return {
          ok: false,
          reason: 'rate',
          retryAt: state.pageRefilledAt + pageRefillMs,
        };
      }

      const wait = Math.max(0, state.nextPageAt - t);
      if (wait > maxPageWaitMs) {
        // Do not hold the UI open for a long pacing gap: treat it as a soft
        // rate limit and let the next card open try again later.
        return { ok: false, reason: 'rate', retryAt: state.nextPageAt };
      }
      if (wait > 0) await sleep(wait);

      const t2 = now();
      state.pageTokens -= 1;
      state.pageLoadsToday += 1;
      state.nextPageAt = t2 + pageIntervalMs + Math.floor(random() * pageJitterMs);
      // A page load counts as a request for the fetch pacing too.
      state.nextAllowedAt = Math.max(state.nextAllowedAt, state.nextPageAt);
      persist();
      return { ok: true };
    });
    pageTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function reportChallenge(host: string): void {
    const state = hostState(host);
    const count = state.challengeCount + 1;
    state.challengeCount = count;
    const cooldown = Math.min(cooldownMaxMs, cooldownBaseMs * 2 ** (count - 1));
    state.cooldownUntil = now() + cooldown;
    // A challenge/block is the one piece of state that must survive an
    // immediate app kill, so write it through without debouncing.
    persistNow();
  }

  function reportRateLimited(host: string, retryAfterMs: number): void {
    const state = hostState(host);
    const cooldown = Math.max(retryAfterMs, minIntervalMs);
    state.cooldownUntil = Math.max(state.cooldownUntil, now() + cooldown);
    persist();
  }

  function reportBlocked(host: string): void {
    const state = hostState(host);
    const until = now() + blockMs;
    state.blockedUntil = Math.max(state.blockedUntil, until);
    state.cooldownUntil = Math.max(state.cooldownUntil, until);
    persistNow();
  }

  function reset(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    tail = Promise.resolve();
    pageTail = Promise.resolve();
    hosts.clear();
    hydrated = true;
    hydratePromise = Promise.resolve();
    // A test/teardown reset must not write the empty ledger back over real
    // state on disk. Hydration is the only thing that enables persistence.
    persistEnabled = false;
    if (persistence) persistence.clear();
  }

  return {
    schedule,
    acquirePageLoad,
    isCoolingDown,
    cooldownRemainingMs,
    blockedRemainingMs,
    reportChallenge,
    reportRateLimited,
    reportBlocked,
    hydrate,
    reset,
  };
}

/** Shared scheduler instance used by the ratings controller. */
export const browseScheduler = createBrowseScheduler({ persistence: FILE_PERSISTENCE });
