/**
 * Tests for publishBudget.ts — the hard per-device daily cap that keeps one
 * install from flooding donation-funded public relays at scale.
 */

import {
  PROBE_BUDGET_PER_DAY,
  PROFILE_BUDGET_PER_DAY,
  MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED,
  MIN_OBSERVATION_SPAN_DAYS,
  __setBudgetStoreForTests,
  budgetLimit,
  canPublishWithinBudget,
  consumePublishBudget,
  freshBudgetState,
  qualifiesForPublish,
  recordPublish,
  remainingPublishBudget,
  utcDayKey,
  type BudgetState,
  type BudgetStore,
} from '../../src/services/traffic/publishBudget';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 12, 9, 0, 0); // fixed instant, mid-day UTC

function memoryStore(initial: BudgetState | null = null): BudgetStore {
  let state = initial;
  return {
    read: () => state,
    write: (next) => {
      state = next;
    },
  };
}

afterEach(() => {
  __setBudgetStoreForTests(null);
});

describe('utcDayKey / limits', () => {
  it('keys by UTC day', () => {
    expect(utcDayKey(T0)).toBe('2026-05-12');
    expect(utcDayKey(T0 + DAY)).toBe('2026-05-13');
  });

  it('exposes per-kind daily limits', () => {
    expect(budgetLimit('probe')).toBe(PROBE_BUDGET_PER_DAY);
    expect(budgetLimit('profile')).toBe(PROFILE_BUDGET_PER_DAY);
  });
});

describe('canPublishWithinBudget', () => {
  it('allows the first publish of a fresh day', () => {
    const { allowed, remaining, state } = canPublishWithinBudget(null, 'probe', T0);
    expect(allowed).toBe(true);
    expect(remaining).toBe(PROBE_BUDGET_PER_DAY);
    expect(state.day).toBe('2026-05-12');
  });

  it('blocks once the daily allowance is exhausted', () => {
    const spent = { day: utcDayKey(T0), probe: PROBE_BUDGET_PER_DAY, profile: 0 };
    expect(canPublishWithinBudget(spent, 'probe', T0).allowed).toBe(false);
    expect(canPublishWithinBudget(spent, 'probe', T0).remaining).toBe(0);
  });

  it('resets counters on a new UTC day', () => {
    const spent = { day: utcDayKey(T0), probe: PROBE_BUDGET_PER_DAY, profile: 5 };
    const next = canPublishWithinBudget(spent, 'probe', T0 + DAY);
    expect(next.allowed).toBe(true);
    expect(next.state.probe).toBe(0);
    expect(next.state.profile).toBe(0);
  });

  it('keeps probe and profile budgets independent', () => {
    const probesSpent = { day: utcDayKey(T0), probe: PROBE_BUDGET_PER_DAY, profile: 0 };
    expect(canPublishWithinBudget(probesSpent, 'profile', T0).allowed).toBe(true);
  });
});

describe('recordPublish', () => {
  it('increments only the given kind', () => {
    const state = recordPublish(freshBudgetState(T0), 'profile', T0);
    expect(state).toEqual({ day: '2026-05-12', probe: 0, profile: 1 });
  });

  it('rolls over before incrementing on a new day', () => {
    const state = recordPublish(
      { day: '2026-05-11', probe: PROBE_BUDGET_PER_DAY, profile: 9 },
      'probe',
      T0,
    );
    expect(state).toEqual({ day: '2026-05-12', probe: 1, profile: 0 });
  });
});

describe('consumePublishBudget', () => {
  it('consumes down to zero then refuses', () => {
    __setBudgetStoreForTests(memoryStore());
    let allowed = 0;
    for (let i = 0; i < PROFILE_BUDGET_PER_DAY + 5; i++) {
      if (consumePublishBudget('profile', T0)) allowed++;
    }
    expect(allowed).toBe(PROFILE_BUDGET_PER_DAY);
    expect(remainingPublishBudget('profile', T0)).toBe(0);
  });

  it('restores the allowance the next day', () => {
    __setBudgetStoreForTests(memoryStore());
    for (let i = 0; i < PROFILE_BUDGET_PER_DAY; i++) consumePublishBudget('profile', T0);
    expect(consumePublishBudget('profile', T0 + DAY)).toBe(true);
  });

  it('never exceeds the cap even when the store throws', () => {
    const throwing: BudgetStore = {
      read: () => {
        throw new Error('boom');
      },
      write: () => {
        throw new Error('boom');
      },
    };
    __setBudgetStoreForTests(throwing);
    // A broken store must not become an unlimited publish licence.
    expect(() => consumePublishBudget('probe', T0)).toThrow();
  });
});

describe('qualifiesForPublish', () => {
  const now = Math.floor(T0 / 1000);
  const base = {
    probeSamples: MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED,
    sampleCount: MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED,
    observedSpanDays: MIN_OBSERVATION_SPAN_DAYS,
    lastUpdated: now - 3600,
  };

  it('accepts a probe-dominant row observed across days', () => {
    expect(qualifiesForPublish(base, now, 21)).toBe(true);
  });

  it('rejects single-day rows', () => {
    expect(qualifiesForPublish({ ...base, observedSpanDays: 0 }, now, 21)).toBe(false);
  });

  it('rejects rows below the scaled probe threshold', () => {
    expect(
      qualifiesForPublish(
        { ...base, probeSamples: MIN_PROBE_SAMPLES_FOR_PUBLISH_SCALED - 1 },
        now,
        21,
      ),
    ).toBe(false);
  });

  it('rejects rows older than retention', () => {
    expect(qualifiesForPublish({ ...base, lastUpdated: now - 30 * 86_400 }, now, 21)).toBe(false);
  });
});
