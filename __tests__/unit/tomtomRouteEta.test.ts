/**
 * Route-ETA caching across a relaunch.
 *
 * Regression: the Calculate Route answer was cached in memory only, so
 * requesting the same directions again after closing and reopening the app
 * re-asked TomTom for a route it had already answered minutes earlier.
 */

const mockMmkvStore = new Map<string, string>();

jest.mock('../../src/services/storage/mmkv', () => ({
  getStorageSync: () => ({
    getString: (key: string) => mockMmkvStore.get(key),
    set: (key: string, value: string) => {
      mockMmkvStore.set(key, value);
    },
    delete: (key: string) => {
      mockMmkvStore.delete(key);
    },
  }),
}));

const mockProviderCalls: string[] = [];

jest.mock('../../src/services/traffic/tomtomAccess', () => ({
  isTomTomConfigured: () => true,
  canCallTomTom: () => true,
  noteTomTomRequest: () => {
    mockProviderCalls.push('request');
  },
  noteTomTomResponse: () => undefined,
  noteTomTomNetworkError: () => undefined,
}));

/**
 * Call log kept in a plain array: `jest.resetModules()` (our relaunch) clears
 * the call history of `jest.fn()`s, so the provider count must not live there.
 */
const mockFetched: string[] = [];

async function mockFetch(url: string) {
  mockFetched.push(url);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      routes: [{ summary: { travelTimeInSeconds: 900, trafficDelayInSeconds: 120 } }],
    }),
  };
}

type RouteEtaModule = typeof import('../../src/services/traffic/tomtomRouteEta');
let routeEta: RouteEtaModule;

const START = { lat: 42.3564, lng: -71.0636 };
const END = { lat: 42.3601, lng: -71.0589 };
const FRESH_ETA = { travelTimeSeconds: 900, trafficDelaySeconds: 120 };

/** Load a fresh copy of the module — i.e. simulate an app launch. */
function launchApp(): void {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  routeEta = require('../../src/services/traffic/tomtomRouteEta') as RouteEtaModule;
}

function agePersistedEntries(byMs: number): void {
  const key = [...mockMmkvStore.keys()][0];
  const entries = JSON.parse(mockMmkvStore.get(key)!) as Record<string, { storedAt: number }>;
  for (const entry of Object.values(entries)) entry.storedAt -= byMs;
  mockMmkvStore.set(key, JSON.stringify(entries));
}

beforeEach(() => {
  mockMmkvStore.clear();
  mockProviderCalls.length = 0;
  mockFetched.length = 0;
  global.fetch = mockFetch as unknown as typeof fetch;
  launchApp();
});

describe('fetchTomTomRouteEta caching', () => {
  it('reuses an answer within the session without a provider call', async () => {
    await routeEta.fetchTomTomRouteEta(START, END);
    const second = await routeEta.fetchTomTomRouteEta(START, END);

    expect(mockFetched.length).toBe(1);
    expect(mockProviderCalls.length).toBe(1);
    expect(second).toEqual(FRESH_ETA);
  });

  it('reuses an answer after a relaunch while it is still fresh', async () => {
    await routeEta.fetchTomTomRouteEta(START, END);
    expect(mockFetched.length).toBe(1);

    launchApp(); // close + reopen: the in-memory cache is gone
    const afterRelaunch = await routeEta.fetchTomTomRouteEta(START, END);

    expect(mockFetched.length).toBe(1);
    expect(mockProviderCalls.length).toBe(1);
    expect(afterRelaunch).toEqual(FRESH_ETA);
  });

  it('re-asks the provider once the persisted answer is stale', async () => {
    await routeEta.fetchTomTomRouteEta(START, END);

    agePersistedEntries(6 * 60 * 1000); // past the 5-minute freshness window

    launchApp();
    await routeEta.fetchTomTomRouteEta(START, END);

    expect(mockFetched.length).toBe(2);
  });

  it('does not extend a persisted answer past its freshness window', async () => {
    await routeEta.fetchTomTomRouteEta(START, END);

    launchApp();
    await routeEta.fetchTomTomRouteEta(START, END); // served from the persisted copy
    expect(mockFetched.length).toBe(1);

    // The same answer keeps ageing: serving it from disk must not restart the
    // clock in the in-memory cache.
    agePersistedEntries(6 * 60 * 1000);
    await routeEta.fetchTomTomRouteEta(START, END);

    expect(mockFetched.length).toBe(2);
  });

  it('keeps different routes on separate cache entries', async () => {
    await routeEta.fetchTomTomRouteEta(START, END);
    await routeEta.fetchTomTomRouteEta(END, START);

    expect(mockFetched.length).toBe(2);
  });

  it('ignores a corrupt persisted store instead of throwing', async () => {
    mockMmkvStore.set('traffic.route-eta.v1', 'not json');
    launchApp();

    await expect(routeEta.fetchTomTomRouteEta(START, END)).resolves.toEqual(FRESH_ETA);
    expect(mockFetched.length).toBe(1);
  });

  it('drops malformed entries so they cannot answer a request', async () => {
    mockMmkvStore.set(
      'traffic.route-eta.v1',
      JSON.stringify({
        '42.356,-71.064-42.360,-71.059': { travelTimeSeconds: 'soon', storedAt: Date.now() },
      }),
    );
    launchApp();

    await routeEta.fetchTomTomRouteEta(START, END);

    expect(mockFetched.length).toBe(1);
  });

  it('never grows the persisted store without bound', async () => {
    // 40 distinct routes, above the cache bound.
    for (let i = 0; i < 40; i++) {
      await routeEta.fetchTomTomRouteEta({ lat: 42.3 + i / 1000, lng: -71.0 }, END);
    }
    const raw = mockMmkvStore.get('traffic.route-eta.v1');
    expect(raw).toBeDefined();
    expect(Object.keys(JSON.parse(raw!)).length).toBeLessThanOrEqual(32);
  });
});
