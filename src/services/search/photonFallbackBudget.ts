/**
 * Per-device daily budget for the Photon text-search fallback.
 *
 * The flag alone (`photonFallbackPolicy`) decides whether the tier exists at
 * all; this decides how much of a shared public instance one device may use.
 * Without it a retry loop, a stuck viewport or a determined user could spend an
 * unbounded amount of komoot's capacity, and there is no published quota to
 * appeal to afterwards.
 *
 * Counters are keyed to the UTC day and persisted in MMKV, so relaunching does
 * not reset the allowance — the same shape as `traffic/publishBudget` and
 * `transit/transitousPlanBudget`.
 *
 * Kept separate from the policy module because this one needs storage, and
 * `config/remoteConfig` applies the flag during boot and must stay light.
 */

import { getStorageSync } from '../storage/mmkv';
import { PHOTON_FALLBACK_BUDGET_PER_DAY, isPhotonFallbackEnabled } from './photonFallbackPolicy';

const STORAGE_KEY = 'search.photon-budget.v1';
const BUDGET_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface PhotonBudget {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string;
  used: number;
}

export interface PhotonStore {
  read(): PhotonBudget | null;
  write(state: PhotonBudget): void;
}

// ── Pure logic (unit tested) ─────────────────────────────────────────

/** UTC day key for an epoch-ms timestamp. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Empty budget for the given day. */
export function freshBudget(nowMs: number): PhotonBudget {
  return { day: utcDayKey(nowMs), used: 0 };
}

/**
 * Roll the budget over to the current day and report whether one more query is
 * allowed. Counters reset at UTC midnight.
 */
export function canSpendQuery(
  state: PhotonBudget | null,
  nowMs: number,
): { allowed: boolean; state: PhotonBudget; remaining: number } {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshBudget(nowMs);
  return {
    allowed: current.used < PHOTON_FALLBACK_BUDGET_PER_DAY,
    state: current,
    remaining: Math.max(0, PHOTON_FALLBACK_BUDGET_PER_DAY - current.used),
  };
}

/** Record one query, returning the new budget. */
export function recordQuery(state: PhotonBudget | null, nowMs: number): PhotonBudget {
  const current = state && state.day === utcDayKey(nowMs) ? state : freshBudget(nowMs);
  return { ...current, used: current.used + 1 };
}

// ── Store ────────────────────────────────────────────────────────────

let memoryBudget: PhotonBudget | null = null;

function defaultStore(): PhotonStore {
  return {
    read: () => {
      try {
        const raw = getStorageSync().getString(STORAGE_KEY);
        if (!raw) return memoryBudget;
        const parsed = JSON.parse(raw) as PhotonBudget & { v?: number };
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

let store: PhotonStore = defaultStore();

// ── Public API ───────────────────────────────────────────────────────

/** True when the tier may be used *and* the device has budget left today. */
export function canUsePhotonFallback(nowMs: number = Date.now()): boolean {
  if (!isPhotonFallbackEnabled()) return false;
  return canSpendQuery(store.read(), nowMs).allowed;
}

/** Spend one query. Call only after {@link canUsePhotonFallback}. */
export function notePhotonFallback(nowMs: number = Date.now()): void {
  // A disabled tier never spends, so a stray call cannot erode the allowance.
  if (!isPhotonFallbackEnabled()) return;
  store.write(recordQuery(store.read(), nowMs));
}

/** Remaining queries today (0 when the tier is disabled). */
export function remainingPhotonQueries(nowMs: number = Date.now()): number {
  if (!isPhotonFallbackEnabled()) return 0;
  return canSpendQuery(store.read(), nowMs).remaining;
}

/** Test-only: reset module state, optionally with an injected store. */
export function __resetPhotonBudgetForTests(injectedStore?: PhotonStore): void {
  memoryBudget = null;
  store = injectedStore ?? defaultStore();
}
