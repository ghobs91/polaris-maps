/**
 * Transitous `/plan` tier gate.
 *
 * The important properties are that the tier is off unless something explicitly
 * enables it, and that the per-device budget is a hard cap that survives a
 * relaunch — a default-on router cannot stay inside Transitous' published
 * 720-per-24h application ceiling.
 */

const mockStorage = new Map<string, string>();

jest.mock('../../src/services/storage/mmkv', () => ({
  getStorageSync: () => ({
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
  }),
  storage: {
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
  },
}));

import {
  TRANSITOUS_PLAN_BUDGET_PER_DAY,
  TRANSITOUS_PLAN_ENV_ENABLED,
  __resetTransitousPlanPolicyForTests,
  isTransitousPlanEnabled,
  setTransitousPlanEnabled,
} from '../../src/services/transit/transitousPlanPolicy';
import {
  __resetTransitousPlanBudgetForTests,
  canSpendPlan,
  canUseTransitousPlan,
  freshPlanBudget,
  noteTransitousPlan,
  recordPlan,
  remainingTransitousPlans,
  utcDayKey,
} from '../../src/services/transit/transitousPlanBudget';

const NOW = Date.UTC(2026, 4, 4, 12, 0, 0);

beforeEach(() => {
  mockStorage.clear();
  __resetTransitousPlanPolicyForTests();
  __resetTransitousPlanBudgetForTests();
});

describe('policy', () => {
  it('is disabled by default', () => {
    expect(TRANSITOUS_PLAN_ENV_ENABLED).toBe(false);
    expect(isTransitousPlanEnabled()).toBe(false);
    expect(canUseTransitousPlan(NOW)).toBe(false);
    expect(remainingTransitousPlans(NOW)).toBe(0);
  });

  it('is enabled by a signed remote flag', () => {
    setTransitousPlanEnabled(true);
    expect(isTransitousPlanEnabled()).toBe(true);
    expect(canUseTransitousPlan(NOW)).toBe(true);
  });

  it('ignores a non-true remote value', () => {
    setTransitousPlanEnabled(false);
    expect(isTransitousPlanEnabled()).toBe(false);
  });
});

describe('budget', () => {
  it('allows the configured number of plans per day', () => {
    setTransitousPlanEnabled(true);
    for (let i = 0; i < TRANSITOUS_PLAN_BUDGET_PER_DAY; i++) {
      expect(canUseTransitousPlan(NOW)).toBe(true);
      noteTransitousPlan(NOW);
    }
    expect(canUseTransitousPlan(NOW)).toBe(false);
    expect(remainingTransitousPlans(NOW)).toBe(0);
  });

  it('stays under the published application-wide ceiling for a small beta', () => {
    // 10 per device per day means 72 devices reach Transitous' 720/24h figure.
    expect(TRANSITOUS_PLAN_BUDGET_PER_DAY * 72).toBeLessThanOrEqual(720);
  });

  it('resets at UTC midnight', () => {
    const state = { day: utcDayKey(NOW), used: TRANSITOUS_PLAN_BUDGET_PER_DAY };
    const tomorrow = NOW + 24 * 60 * 60 * 1000;
    expect(canSpendPlan(state, tomorrow).allowed).toBe(true);
    expect(canSpendPlan(state, tomorrow).remaining).toBe(TRANSITOUS_PLAN_BUDGET_PER_DAY);
  });

  it('survives a relaunch through storage', () => {
    setTransitousPlanEnabled(true);
    noteTransitousPlan(NOW);

    // Simulate a fresh process: module state resets, storage does not.
    __resetTransitousPlanBudgetForTests();
    setTransitousPlanEnabled(true);

    expect(remainingTransitousPlans(NOW)).toBe(TRANSITOUS_PLAN_BUDGET_PER_DAY - 1);
  });

  it('ignores counters written by an older budget version', () => {
    mockStorage.set(
      'transit.transitous-plan-budget.v1',
      JSON.stringify({ day: utcDayKey(NOW), used: 999, v: 0 }),
    );
    setTransitousPlanEnabled(true);
    expect(remainingTransitousPlans(NOW)).toBe(TRANSITOUS_PLAN_BUDGET_PER_DAY);
  });

  it('does not spend budget while the tier is disabled', () => {
    noteTransitousPlan(NOW);
    setTransitousPlanEnabled(true);
    expect(remainingTransitousPlans(NOW)).toBe(TRANSITOUS_PLAN_BUDGET_PER_DAY);
  });
});

describe('pure helpers', () => {
  it('starts a fresh budget at zero', () => {
    expect(freshPlanBudget(NOW)).toEqual({ day: utcDayKey(NOW), used: 0 });
  });

  it('records plans cumulatively within a day', () => {
    const once = recordPlan(null, NOW);
    expect(recordPlan(once, NOW).used).toBe(2);
  });
});
