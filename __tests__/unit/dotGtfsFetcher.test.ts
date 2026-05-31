/**
 * Tests for dotGtfsFetcher.ts — the DOT GTFS feed download + parse pipeline.
 */

// Mock the transit store
const mockSetGtfsLoadingAgency = jest.fn();
jest.mock('../../src/stores/transitStore', () => ({
  useTransitStore: {
    getState: jest.fn(() => ({
      setGtfsLoadingAgency: mockSetGtfsLoadingAgency,
    })),
  },
}));

jest.mock('../../src/services/transit/dotGtfsIndex', () => ({
  lookupDotGtfsFeeds: jest.fn(),
}));

jest.mock('../../src/services/transit/gtfsParser', () => ({
  extractZipTexts: jest.fn(),
  parseGtfsFeed: jest.fn(),
  convertFeedToLines: jest.fn(),
  ALL_ROUTE_TYPES: [0, 1, 2, 3, 4, 5, 6, 7],
}));

// Mock MMKV storage (native module)
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: jest.fn(() => null),
    set: jest.fn(),
    delete: jest.fn(),
    getAllKeys: jest.fn(() => []),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { fetchDotGtfsLines, clearDotGtfsCache } from '../../src/services/transit/dotGtfsFetcher';
import { lookupDotGtfsFeeds } from '../../src/services/transit/dotGtfsIndex';
import {
  extractZipTexts,
  parseGtfsFeed,
  convertFeedToLines,
} from '../../src/services/transit/gtfsParser';
import type { DotGtfsFeedEntry } from '../../src/services/transit/dotGtfsIndex';

function makeFeed(overrides: Partial<DotGtfsFeedEntry> = {}): DotGtfsFeedEntry {
  return {
    id: '00001:MB',
    ntdId: '00001',
    agencyName: 'Test Transit',
    city: 'Testville',
    state: 'TX',
    modeName: 'Bus',
    modeAbbr: 'MB',
    uzaName: 'Testville, TX',
    uzaPop: 500000,
    weblink: 'https://example.com/gtfs.zip',
    lat: 30.0,
    lng: -97.0,
    dateValidated: '2026-01-01',
    certified: true,
    ...overrides,
  };
}

function makeGtfsFeedData() {
  return {
    feedId: 'dot:00001',
    provider: 'Test Transit',
    feedName: 'Test Transit',
    routes: [{ route_id: 'R1', route_short_name: '1', route_long_name: 'Line 1', route_type: 3 }],
    stops: [{ stop_id: 'S1', stop_name: 'Stop 1', stop_lat: 30.0, stop_lon: -97.0 }],
    trips: [{ trip_id: 'T1', route_id: 'R1', service_id: 'svc', shape_id: 'shape1' }],
    stopTimes: [
      {
        trip_id: 'T1',
        arrival_time: '08:00',
        departure_time: '08:01',
        stop_id: 'S1',
        stop_sequence: 1,
      },
    ],
    shapes: new Map([
      [
        'shape1',
        [
          [-97.0, 30.0],
          [-97.01, 30.01],
        ] as [number, number][],
      ],
    ]),
    tripIndex: new Map(),
    stopIndex: new Map(),
    routeIndex: new Map(),
    stopTrips: new Map(),
  };
}

describe('dotGtfsFetcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDotGtfsCache();
    (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([]);
    (extractZipTexts as jest.Mock).mockResolvedValue(new Map());
    (parseGtfsFeed as jest.Mock).mockReturnValue(null);
    (convertFeedToLines as jest.Mock).mockResolvedValue([]);
    mockFetch.mockReset();
  });

  describe('fetchDotGtfsLines', () => {
    it('returns empty array when lookup returns no feeds', async () => {
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([]);
      const lines = await fetchDotGtfsLines(30.0, -97.0, 1.0);
      expect(lines).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sets and clears loading state', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any);
      (parseGtfsFeed as jest.Mock).mockReturnValue(makeGtfsFeedData());

      await fetchDotGtfsLines(30.0, -97.0, 1.0);

      expect(mockSetGtfsLoadingAgency).toHaveBeenCalledWith('Test Transit');
      expect(mockSetGtfsLoadingAgency).toHaveBeenLastCalledWith(null);
    });

    it('sets loading state with count for multiple agencies', async () => {
      const feeds = [
        makeFeed(),
        makeFeed({
          agencyName: 'Other Agency',
          id: '00002:MB',
          ntdId: '00002',
          weblink: 'https://example.com/other.zip',
        }),
      ];
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue(feeds);
      mockFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any);
      (parseGtfsFeed as jest.Mock).mockReturnValue(makeGtfsFeedData());

      await fetchDotGtfsLines(30.0, -97.0, 1.0);
      expect(mockSetGtfsLoadingAgency).toHaveBeenCalledWith('Test Transit + 1 other');
    });

    it('skips feeds that return non-ok status', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as any);

      const lines = await fetchDotGtfsLines(30.0, -97.0, 1.0);
      expect(lines).toEqual([]);
    });

    it('catches network errors gracefully', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const lines = await fetchDotGtfsLines(30.0, -97.0, 1.0);
      expect(lines).toEqual([]);
    });

    it('downloads and converts feeds to TransitRouteLine[]', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as any);

      const filesMap = new Map([['routes.txt', 'mock']]);
      (extractZipTexts as jest.Mock).mockResolvedValueOnce(filesMap);

      const feedData = makeGtfsFeedData();
      (parseGtfsFeed as jest.Mock).mockReturnValueOnce(feedData);

      const mockLines = [
        { id: 'R1', name: 'Line 1', geometry: [[[-97.0, 30.0]]], stops: [], mode: 'BUS' as any },
      ];
      (convertFeedToLines as jest.Mock).mockResolvedValueOnce(mockLines);

      const lines = await fetchDotGtfsLines(30.0, -97.0, 1.0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(extractZipTexts).toHaveBeenCalledTimes(1);
      expect(parseGtfsFeed).toHaveBeenCalledTimes(1);
      expect(lines).toEqual(mockLines);
    });

    it('skips already-cached feeds', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);

      // First call: download and cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as any);
      (extractZipTexts as jest.Mock).mockResolvedValueOnce(new Map([['routes.txt', 'mock']]));
      (parseGtfsFeed as jest.Mock).mockReturnValueOnce(makeGtfsFeedData());
      (convertFeedToLines as jest.Mock).mockResolvedValueOnce([]);
      await fetchDotGtfsLines(30.0, -97.0, 1.0);

      // Reset mock counts
      mockFetch.mockClear();
      (extractZipTexts as jest.Mock).mockClear();

      // Second call: should use cache (no fetch needed)
      (convertFeedToLines as jest.Mock).mockResolvedValueOnce([]);
      await fetchDotGtfsLines(30.0, -97.0, 1.0);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('clearDotGtfsCache', () => {
    it('clears the cache so feeds are re-fetched', async () => {
      const feed = makeFeed();
      (lookupDotGtfsFeeds as jest.Mock).mockResolvedValue([feed]);

      // First call: download and cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as any);
      (extractZipTexts as jest.Mock).mockResolvedValueOnce(new Map([['routes.txt', 'mock']]));
      (parseGtfsFeed as jest.Mock).mockReturnValueOnce(makeGtfsFeedData());
      (convertFeedToLines as jest.Mock).mockResolvedValueOnce([]);
      await fetchDotGtfsLines(30.0, -97.0, 1.0);

      mockFetch.mockClear();
      (extractZipTexts as jest.Mock).mockClear();
      clearDotGtfsCache();

      // Second call: should re-download because cache was cleared
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as any);
      (extractZipTexts as jest.Mock).mockResolvedValueOnce(new Map([['routes.txt', 'mock']]));
      (parseGtfsFeed as jest.Mock).mockReturnValueOnce(makeGtfsFeedData());
      (convertFeedToLines as jest.Mock).mockResolvedValueOnce([]);
      await fetchDotGtfsLines(30.0, -97.0, 1.0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
