/**
 * Tier wiring in `planTransitTrip`.
 *
 * The pure decision is tested in `transitPlanTiers`; what matters here is that
 * the planner *uses* it — local before network, zero requests when a pack
 * covers the area, and the Transitous tier reachable only through its budget.
 */

jest.mock('expo-sqlite', () => ({}));

const mockStorage = new Map<string, string>();
jest.mock('../../src/services/storage/mmkv', () => {
  const api = {
    getString: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    delete: (key: string) => mockStorage.delete(key),
    getAllKeys: () => [...mockStorage.keys()],
  };
  return { getStorageSync: () => api, storage: api, getStorage: async () => api };
});

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

jest.mock('../../src/constants/config', () => ({
  ...jest.requireActual('../../src/constants/config'),
  OTP_BASE_URL: '',
  OTP_GRAPHQL_PATH: '/otp/gtfs/v1',
}));

const mockAvailability = jest.fn();
const mockLocalPlan = jest.fn();
jest.mock('../../src/services/transit/transitTimetablePlanner', () => ({
  localTimetableAvailability: (...args: unknown[]) => mockAvailability(...args),
  planWithLocalTimetable: (...args: unknown[]) => mockLocalPlan(...args),
}));

const mockFindEndpoint = jest.fn();
jest.mock('../../src/services/transit/otpEndpointRegistry', () => ({
  findEndpointForCoords: (...args: unknown[]) => mockFindEndpoint(...args),
  OTP_ENDPOINTS: [],
}));

const mockTransitousPlan = jest.fn();
jest.mock('../../src/services/transit/transitousRouting', () => ({
  planTransitousTrip: (...args: unknown[]) => mockTransitousPlan(...args),
}));

jest.mock('../../src/services/transit/transitDepartureFetcher', () => ({
  fetchDepartures: jest.fn(),
}));

import { planTransitTrip } from '../../src/services/transit/transitRoutingService';
import {
  __resetTransitousPlanBudgetForTests,
  remainingTransitousPlans,
} from '../../src/services/transit/transitousPlanBudget';
import {
  __resetTransitousPlanPolicyForTests,
  setTransitousPlanEnabled,
} from '../../src/services/transit/transitousPlanPolicy';
import { TransitPlanError } from '../../src/services/transit/transitPlanTiers';
import type { OtpItinerary } from '../../src/models/transit';

const itinerary: OtpItinerary = {
  start: '2026-05-04T08:00:00.000Z',
  end: '2026-05-04T08:30:00.000Z',
  duration: 1800,
  walkDistance: 100,
  waitingTime: 0,
  transfers: 0,
  legs: [],
};

const FROM = { lat: 41.88, lng: -87.63 };
const TO = { lat: 41.89, lng: -87.62 };

beforeEach(() => {
  mockStorage.clear();
  mockAvailability.mockReset();
  mockLocalPlan.mockReset();
  mockFindEndpoint.mockReset();
  mockTransitousPlan.mockReset();
  __resetTransitousPlanPolicyForTests();
  __resetTransitousPlanBudgetForTests();
  mockFindEndpoint.mockReturnValue(null);
});

describe('local tier', () => {
  it('plans from the pack and issues no network request', async () => {
    mockAvailability.mockResolvedValue({ state: 'usable', registration: {}, meta: {} });
    mockLocalPlan.mockResolvedValue([itinerary]);

    const result = await planTransitTrip({ from: FROM, to: TO });

    expect(result).toEqual([itinerary]);
    expect(mockTransitousPlan).not.toHaveBeenCalled();
    expect(mockLocalPlan).toHaveBeenCalledTimes(1);
  });

  it('does not consult the local planner when no pack covers the area', async () => {
    mockAvailability.mockResolvedValue({ state: 'absent', registration: null, meta: null });

    await expect(planTransitTrip({ from: FROM, to: TO })).rejects.toBeInstanceOf(TransitPlanError);
    expect(mockLocalPlan).not.toHaveBeenCalled();
  });

  it('falls through when the pack is usable but finds no route', async () => {
    mockAvailability.mockResolvedValue({ state: 'usable', registration: {}, meta: {} });
    mockLocalPlan.mockResolvedValue([]);
    mockFindEndpoint.mockReturnValue({ apiStyle: 'rest-v1', url: 'https://regional/graphql' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { planConnection: { edges: [] } } }),
    }) as unknown as typeof fetch;

    // Nothing connects anywhere; the result is empty rather than an error.
    await expect(planTransitTrip({ from: FROM, to: TO })).resolves.toEqual([]);
  });
});

describe('transitous tier', () => {
  beforeEach(() => {
    mockAvailability.mockResolvedValue({ state: 'absent', registration: null, meta: null });
  });

  it('is unreachable while the policy is off', async () => {
    await expect(planTransitTrip({ from: FROM, to: TO })).rejects.toMatchObject({
      reason: 'no-coverage',
    });
    expect(mockTransitousPlan).not.toHaveBeenCalled();
  });

  it('is used when enabled and spends one plan from the daily budget', async () => {
    setTransitousPlanEnabled(true);
    mockTransitousPlan.mockResolvedValue([itinerary]);

    const before = remainingTransitousPlans();
    const result = await planTransitTrip({ from: FROM, to: TO });

    expect(result).toEqual([itinerary]);
    expect(mockTransitousPlan).toHaveBeenCalledTimes(1);
    expect(remainingTransitousPlans()).toBe(before - 1);
  });

  it('reports the exhausted budget instead of calling out', async () => {
    setTransitousPlanEnabled(true);
    const budget = { day: new Date().toISOString().slice(0, 10), used: 10 };
    __resetTransitousPlanBudgetForTests({
      read: () => budget,
      write: () => {},
    });

    await expect(planTransitTrip({ from: FROM, to: TO })).rejects.toMatchObject({
      reason: 'transitous-budget-exhausted',
    });
    expect(mockTransitousPlan).not.toHaveBeenCalled();
  });

  it('treats the world-bbox registry entry as the transitous tier, not a regional one', async () => {
    // The registry's catch-all must not make an uncovered area look covered.
    mockFindEndpoint.mockReturnValue({
      apiStyle: 'transitous-v1',
      url: 'https://api.transitous.org',
    });
    setTransitousPlanEnabled(true);
    mockTransitousPlan.mockResolvedValue([itinerary]);

    await expect(planTransitTrip({ from: FROM, to: TO })).resolves.toEqual([itinerary]);
    expect(mockTransitousPlan).toHaveBeenCalledTimes(1);
  });
});

describe('expired timetable', () => {
  it('names the expiry when nothing else can answer', async () => {
    mockAvailability.mockResolvedValue({ state: 'expired', registration: {}, meta: {} });

    await expect(planTransitTrip({ from: FROM, to: TO })).rejects.toMatchObject({
      reason: 'timetable-expired',
    });
  });
});
