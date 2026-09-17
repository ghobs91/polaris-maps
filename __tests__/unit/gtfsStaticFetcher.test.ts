/**
 * Tests for gtfsStaticFetcher caching + failure behaviour: the persistent MMKV
 * cache is used before the network, expired entries are dropped, and a failed
 * download returns an empty list without throwing.
 */

const mockStore = new Map<string, string>();

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    delete: (key: string) => mockStore.delete(key),
    getAllKeys: () => [...mockStore.keys()],
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '0'.repeat(32)) }));

import { fetchGtfsStaticLines, clearGtfsCache } from '../../src/services/transit/gtfsStaticFetcher';
import type { TransitRouteLine } from '../../src/models/transit';

const mockFetch = jest.fn();

const line: TransitRouteLine = {
  id: 'route-1',
  name: 'S-Tog A',
  ref: 'A',
  color: 'FF0000',
  mode: 'RAIL',
  geometry: [
    [
      [12.5, 55.6],
      [12.6, 55.7],
    ],
  ],
  stops: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  clearGtfsCache();
  global.fetch = mockFetch as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

describe('fetchGtfsStaticLines persistent cache', () => {
  it('serves lines from the MMKV cache without a network request', async () => {
    mockStore.set(
      'transit_lines:Denmark GTFS',
      JSON.stringify({ lines: [line], cachedAt: Date.now() }),
    );

    const result = await fetchGtfsStaticLines({
      label: 'Denmark GTFS',
      routeTypeFilter: [],
      filterByRouteType: false,
      timeoutMs: 60_000,
    });

    expect(result).toHaveLength(1);
    expect(result[0].ref).toBe('A');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores and deletes an expired cache entry, then fails soft', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    mockStore.set(
      'transit_lines:Old GTFS',
      JSON.stringify({ lines: [line], cachedAt: eightDaysAgo }),
    );
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchGtfsStaticLines({
      label: 'Old GTFS',
      feedUrl: 'https://example.com/feed.zip',
      routeTypeFilter: [],
    });

    expect(result).toEqual([]);
    expect(mockStore.has('transit_lines:Old GTFS')).toBe(false);
  });

  it('returns an empty list when the download fails (offline / bad URL)', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await fetchGtfsStaticLines({
      label: 'Unreachable GTFS',
      feedUrl: 'https://example.com/feed.zip',
      routeTypeFilter: [],
    });

    expect(result).toEqual([]);
  });

  it('caches in memory so a second call does not re-fetch', async () => {
    mockStore.set(
      'transit_lines:Cached GTFS',
      JSON.stringify({ lines: [line], cachedAt: Date.now() }),
    );
    const config = { label: 'Cached GTFS', routeTypeFilter: [] as number[] };

    await fetchGtfsStaticLines(config);
    await fetchGtfsStaticLines(config);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
