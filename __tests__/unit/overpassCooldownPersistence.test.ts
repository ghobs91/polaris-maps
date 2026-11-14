/**
 * Mirror cooldowns survive a relaunch.
 *
 * Cooldowns describe somebody else's server. Forgetting them on every cold
 * start means each device re-probes a mirror that already said "go away", which
 * is how a small app turns a volunteer outage into a request storm.
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

const mockStore = new Map<string, string>();
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    delete: (key: string) => mockStore.delete(key),
  },
  getStorage: async () => null,
  getStorageSync: () => null,
}));

import {
  OVERPASS_MIRRORS,
  __resetOverpassPolicyForTests,
  __setOverpassClockForTests,
  __setOverpassMinIntervalMsForTests,
  overpassFetch,
} from '../../src/services/overpassClient';

const STORAGE_KEY = 'overpass.policy.v1';
const PRIMARY = OVERPASS_MIRRORS[0];
const SECONDARY = OVERPASS_MIRRORS[1];

let now = 1_000_000_000;

function statusResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function requestedHosts(): string[] {
  return mockFetch.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  mockStore.clear();
  mockFetch.mockReset();
  __resetOverpassPolicyForTests();
  __setOverpassClockForTests(() => now);
  __setOverpassMinIntervalMsForTests(0);
  now = 1_000_000_000;
});

it('records a rate-limited mirror in local storage', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    url === PRIMARY ? statusResponse(429) : okResponse({ elements: [] }),
  );

  await overpassFetch({ query: 'test', timeoutMs: 1_000 });

  expect(mockStore.has(STORAGE_KEY)).toBe(true);
  const persisted = JSON.parse(mockStore.get(STORAGE_KEY)!);
  expect(Object.keys(persisted)).toContain(PRIMARY);
  expect(persisted[PRIMARY].cooldownUntil).toBeGreaterThan(now);
});

it('does not re-probe that mirror after a relaunch', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    url === PRIMARY ? statusResponse(429) : okResponse({ elements: [] }),
  );
  await overpassFetch({ query: 'test', timeoutMs: 1_000 });
  expect(requestedHosts()).toContain(PRIMARY);

  // Simulate a relaunch: in-memory policy goes away, the cache does not.
  const disk = mockStore.get(STORAGE_KEY)!;
  __resetOverpassPolicyForTests();
  mockStore.set(STORAGE_KEY, disk);

  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => okResponse({ elements: [] }));
  __setOverpassClockForTests(() => now);

  await overpassFetch({ query: 'test', timeoutMs: 1_000 });

  expect(requestedHosts()).not.toContain(PRIMARY);
  expect(requestedHosts()).toContain(SECONDARY);
});

it('drops expired cooldowns instead of honouring them forever', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    url === PRIMARY ? statusResponse(429) : okResponse({ elements: [] }),
  );
  await overpassFetch({ query: 'test', timeoutMs: 1_000 });

  const disk = mockStore.get(STORAGE_KEY)!;
  __resetOverpassPolicyForTests();

  // A day later the whole window is stale; the primary is tried again.
  now += 24 * 60 * 60 * 1_000;
  mockStore.set(STORAGE_KEY, disk);

  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => okResponse({ elements: [] }));
  __setOverpassClockForTests(() => now);

  await overpassFetch({ query: 'test', timeoutMs: 1_000 });

  expect(requestedHosts()).toContain(PRIMARY);
  // A success clears the record rather than leaving a stale entry behind.
  expect(mockStore.has(STORAGE_KEY)).toBe(false);
});

it('ignores a corrupt cache', async () => {
  mockStore.set(STORAGE_KEY, '{not json');
  mockFetch.mockImplementation(async () => okResponse({ elements: [] }));

  await expect(overpassFetch({ query: 'test', timeoutMs: 1_000 })).resolves.toEqual({
    elements: [],
  });
  expect(requestedHosts()).toContain(PRIMARY);
});
