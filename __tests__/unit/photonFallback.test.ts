/**
 * Photon fallback gate and rationing.
 *
 * Photon is komoot's free public instance with no published quota, so the
 * mitigation is a hard per-device allowance rather than a policy ceiling. These
 * pin the three behaviours that make that real: a disabled flag means no call
 * at all, the allowance resets at UTC midnight, and a spent device stops
 * spending rather than degrading into a retry loop.
 */

jest.mock('../../src/services/storage/mmkv', () => ({ getStorageSync: jest.fn() }));

import {
  canSpendQuery,
  canUsePhotonFallback,
  notePhotonFallback,
  recordQuery,
  remainingPhotonQueries,
  utcDayKey,
  __resetPhotonBudgetForTests,
  type PhotonBudget,
  type PhotonStore,
} from '../../src/services/search/photonFallbackBudget';
import {
  PHOTON_FALLBACK_BUDGET_PER_DAY,
  isPhotonFallbackEnabled,
  setPhotonFallbackEnabled,
  __resetPhotonFallbackPolicyForTests,
} from '../../src/services/search/photonFallbackPolicy';

const NOON = Date.UTC(2026, 10, 13, 12, 0, 0);

function memoryStore(): PhotonStore & { state: PhotonBudget | null } {
  const store = {
    state: null as PhotonBudget | null,
    read() {
      return store.state;
    },
    write(next: PhotonBudget) {
      store.state = next;
    },
  };
  return store;
}

describe('photon fallback policy', () => {
  afterEach(() => __resetPhotonFallbackPolicyForTests());

  it('is enabled by default and can be turned off remotely', () => {
    expect(isPhotonFallbackEnabled()).toBe(true);
    setPhotonFallbackEnabled(false);
    expect(isPhotonFallbackEnabled()).toBe(false);
  });
});

describe('photon fallback budget', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
    __resetPhotonFallbackPolicyForTests();
    __resetPhotonBudgetForTests(store);
  });

  afterEach(() => __resetPhotonBudgetForTests());

  it('allows queries up to the daily allowance', () => {
    let state: PhotonBudget | null = null;
    for (let i = 0; i < PHOTON_FALLBACK_BUDGET_PER_DAY; i++) {
      expect(canSpendQuery(state, NOON).allowed).toBe(true);
      state = recordQuery(state, NOON);
    }
    expect(canSpendQuery(state, NOON).allowed).toBe(false);
    expect(canSpendQuery(state, NOON).remaining).toBe(0);
  });

  it('resets at UTC midnight', () => {
    const spent: PhotonBudget = { day: utcDayKey(NOON), used: PHOTON_FALLBACK_BUDGET_PER_DAY };
    expect(canSpendQuery(spent, NOON).allowed).toBe(false);

    const nextDay = NOON + 24 * 60 * 60 * 1000;
    expect(canSpendQuery(spent, nextDay).allowed).toBe(true);
    expect(canSpendQuery(spent, nextDay).state.used).toBe(0);
  });

  it('does not spend when the tier is disabled', () => {
    setPhotonFallbackEnabled(false);
    expect(canUsePhotonFallback(NOON)).toBe(false);
    notePhotonFallback(NOON);
    expect(store.state).toBeNull();
    expect(remainingPhotonQueries(NOON)).toBe(0);
  });

  it('spends through the store and reports the remaining allowance', () => {
    expect(remainingPhotonQueries(NOON)).toBe(PHOTON_FALLBACK_BUDGET_PER_DAY);
    notePhotonFallback(NOON);
    expect(remainingPhotonQueries(NOON)).toBe(PHOTON_FALLBACK_BUDGET_PER_DAY - 1);
    expect(store.state?.day).toBe(utcDayKey(NOON));
  });

  it('stops spending once the device is out of allowance', () => {
    store.state = { day: utcDayKey(NOON), used: PHOTON_FALLBACK_BUDGET_PER_DAY };
    expect(canUsePhotonFallback(NOON)).toBe(false);
  });
});
