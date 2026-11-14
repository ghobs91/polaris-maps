import { getStorageSync } from '../storage/mmkv';

/**
 * Traffic publish budget.
 *
 * Public Nostr relays are donation-funded, so a device must never be able to
 * flood them. This module enforces a per-device, per-day allowance for
 * traffic-related publishes (probes and weekly profiles), with separate
 * buckets so profile publishing can never starve live probes.
 *
 * The budget is a *hard* local cap: once exhausted, the device falls back to
 * Hyperswarm-only (or silence) until the next UTC day. Counters are persisted
 * so a relaunch cannot reset the allowance.
 *
 * Pure decision logic is exported for tests; the counter store is injectable.
 */

// ── Tunables ─────────────────────────────────────────────────────────

/** Ephemeral probe publishes per device per day. */
export const PROBE_BUDGET_PER_DAY = 240;

/** Stored weekly-profile publishes per device per day. */
export const PROFILE_BUDGET_PER_DAY = 60;

/** Minimum probe-derived samples before a row may be published (scale-safe). */
export const MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED = 20;

/**
 * Minimum observation span (days between the first and last observation of a
 * row) before publishing. A single drive past a cell is not a weekly pattern;
 * requiring the row to have been observed on at least two different days keeps
 * one-off rows out and cuts relay volume substantially.
 */
export const MIN_OBSERVATION_SPAN_DAYS = 1;

/** Bump when the budget semantics change so stale counters are ignored. */
const BUDGET_VERSION = 1;

const STORAGE_KEY = 'traffic.publish-budget.v1';

// ── Types ────────────────────────────────────────────────────────────

export type BudgetKind = 'probe' | 'profile';

export interface BudgetState {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string;
  probe: number;
  profile: number;
}

export interface BudgetStore {
  read(): BudgetState | null;
  write(state: BudgetState): void;
}

// ── Pure logic (unit tested) ─────────────────────────────────────────

/** UTC day key for an epoch-ms timestamp. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Daily allowance for a budget kind. */
export function budgetLimit(kind: BudgetKind): number {
  return kind === 'probe' ? PROBE_BUDGET_PER_DAY : PROFILE_BUDGET_PER_DAY;
}

/** Empty state for the given day. */
export function freshBudgetState(nowMs: number): BudgetState {
  return { day: utcDayKey(nowMs), probe: 0, profile: 0 };
}

/**
 * Roll the state over to the current day (counters reset at UTC midnight) and
 * report whether one more publish of `kind` is allowed.
 */
export function canPublishWithinBudget(
  state: BudgetState | null,
  kind: BudgetKind,
  nowMs: number,
): { allowed: boolean; state: BudgetState; remaining: number } {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshBudgetState(nowMs);
  const used = current[kind];
  const limit = budgetLimit(kind);
  return {
    allowed: used < limit,
    state: current,
    remaining: Math.max(0, limit - used),
  };
}

/** Record one publish of `kind`, returning the new state. */
export function recordPublish(
  state: BudgetState | null,
  kind: BudgetKind,
  nowMs: number,
): BudgetState {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshBudgetState(nowMs);
  return { ...current, [kind]: current[kind] + 1 };
}

// ── Store ────────────────────────────────────────────────────────────

const memoryStore: BudgetStore = (() => {
  let state: BudgetState | null = null;
  return {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
})();

function persistentStore(): BudgetStore {
  return {
    read: () => {
      try {
        const raw = getStorageSync().getString(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as BudgetState & { v?: number };
        if (parsed.v !== undefined && parsed.v !== BUDGET_VERSION) return null;
        return { day: parsed.day, probe: parsed.probe, profile: parsed.profile };
      } catch {
        return null;
      }
    },
    write: (next) => {
      try {
        getStorageSync().set(STORAGE_KEY, JSON.stringify({ ...next, v: BUDGET_VERSION }));
      } catch {
        // Storage unavailable — the in-memory fallback still bounds this run.
        memoryStore.write(next);
      }
    },
  };
}

let store: BudgetStore | null = null;

function activeStore(): BudgetStore {
  if (!store) {
    try {
      getStorageSync();
      store = persistentStore();
    } catch {
      // MMKV not initialised yet (early boot / tests)
      store = memoryStore;
    }
  }
  return store;
}

/** Test-only: swap the backing store. */
export function __setBudgetStoreForTests(next: BudgetStore | null): void {
  store = next;
}

/**
 * Consume one unit of the day's budget for `kind`.
 *
 * Returns false (and consumes nothing) when the allowance is exhausted.
 */
export function consumePublishBudget(kind: BudgetKind, nowMs: number = Date.now()): boolean {
  const backing = activeStore();
  const { allowed, state } = canPublishWithinBudget(backing.read(), kind, nowMs);
  if (!allowed) return false;
  backing.write(recordPublish(state, kind, nowMs));
  return true;
}

/** Remaining allowance for today, for diagnostics/UI. */
export function remainingPublishBudget(kind: BudgetKind, nowMs: number = Date.now()): number {
  const backing = activeStore();
  return canPublishWithinBudget(backing.read(), kind, nowMs).remaining;
}

/**
 * Whether a historical row qualifies for shared-transport publication at
 * scale: probe-dominant, well-sampled, observed across multiple days.
 */
export function qualifiesForPublish(
  row: {
    probeSamples: number;
    sampleCount: number;
    /** Days between the row's first and last observation (0 = single day). */
    observedSpanDays?: number;
    lastUpdated: number;
  },
  nowSec: number,
  maxAgeDays: number,
): boolean {
  if (row.lastUpdated < nowSec - maxAgeDays * 86_400) return false;
  if (row.probeSamples < MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED) return false;
  if (row.sampleCount < MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED) return false;
  if ((row.observedSpanDays ?? 0) < MIN_OBSERVATION_SPAN_DAYS) return false;
  return true;
}
