/**
 * Per-device daily budget for the Transitous `/plan` tier.
 *
 * Transitous publishes a 720-requests-per-24h ceiling for the *whole
 * application* (see `transitousPlanPolicy`). A flag alone cannot enforce that:
 * the tier also has to be rationed per device so a single user cannot spend the
 * application's allowance, and so the total stays bounded once the flag is on.
 *
 * Counters are keyed to the UTC day and persisted in MMKV, so relaunching the
 * app does not reset the allowance — the same shape as the traffic publish
 * budget in `services/traffic/publishBudget`.
 *
 * Kept separate from the policy module because this one needs storage, and
 * `config/remoteConfig` applies the flag during boot and must stay light.
 */

import { getStorageSync } from '../storage/mmkv';
import { TRANSITOUS_PLAN_BUDGET_PER_DAY, isTransitousPlanEnabled } from './transitousPlanPolicy';

const STORAGE_KEY = 'transit.transitous-plan-budget.v1';
const BUDGET_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface TransitousPlanBudget {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string;
  used: number;
}

export interface TransitousPlanStore {
  read(): TransitousPlanBudget | null;
  write(state: TransitousPlanBudget): void;
}

// ── Pure logic (unit tested) ─────────────────────────────────────────

/** UTC day key for an epoch-ms timestamp. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Empty budget for the given day. */
export function freshPlanBudget(nowMs: number): TransitousPlanBudget {
  return { day: utcDayKey(nowMs), used: 0 };
}

/**
 * Roll the budget over to the current day and report whether one more plan is
 * allowed. Counters reset at UTC midnight.
 */
export function canSpendPlan(
  state: TransitousPlanBudget | null,
  nowMs: number,
): { allowed: boolean; state: TransitousPlanBudget; remaining: number } {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshPlanBudget(nowMs);
  return {
    allowed: current.used < TRANSITOUS_PLAN_BUDGET_PER_DAY,
    state: current,
    remaining: Math.max(0, TRANSITOUS_PLAN_BUDGET_PER_DAY - current.used),
  };
}

/** Record one plan, returning the new budget. */
export function recordPlan(
  state: TransitousPlanBudget | null,
  nowMs: number,
): TransitousPlanBudget {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshPlanBudget(nowMs);
  return { ...current, used: current.used + 1 };
}

// ── Store ────────────────────────────────────────────────────────────

let memoryBudget: TransitousPlanBudget | null = null;

function defaultStore(): TransitousPlanStore {
  return {
    read: () => {
      try {
        const raw = getStorageSync().getString(STORAGE_KEY);
        if (!raw) return memoryBudget;
        const parsed = JSON.parse(raw) as TransitousPlanBudget & { v?: number };
        if (parsed.v !== undefined && parsed.v !== BUDGET_VERSION) return null;
        return { day: parsed.day, used: parsed.used };
      } catch {
        return memoryBudget;
      }
    },
    write: (next) => {
      memoryBudget = next;
      try {
        getStorageSync().set(STORAGE_KEY, JSON.stringify({ ...next, v: BUDGET_VERSION }));
      } catch {
        // Storage unavailable — the in-memory copy still bounds this run.
      }
    },
  };
}

let store: TransitousPlanStore = defaultStore();

// ── Public API ───────────────────────────────────────────────────────

/** True when the tier may be used *and* the device has budget left today. */
export function canUseTransitousPlan(nowMs: number = Date.now()): boolean {
  if (!isTransitousPlanEnabled()) return false;
  return canSpendPlan(store.read(), nowMs).allowed;
}

/** Spend one plan from today's budget. Call only after {@link canUseTransitousPlan}. */
export function noteTransitousPlan(nowMs: number = Date.now()): void {
  // A disabled tier never spends, so a stray call cannot erode the allowance.
  if (!isTransitousPlanEnabled()) return;
  store.write(recordPlan(store.read(), nowMs));
}

/** Remaining plans today (0 when the tier is disabled). */
export function remainingTransitousPlans(nowMs: number = Date.now()): number {
  if (!isTransitousPlanEnabled()) return 0;
  return canSpendPlan(store.read(), nowMs).remaining;
}

/** Test-only: reset module state, optionally with an injected store. */
export function __resetTransitousPlanBudgetForTests(injectedStore?: TransitousPlanStore): void {
  memoryBudget = null;
  store = injectedStore ?? defaultStore();
}
