/**
 * Tests for dotGtfsIndex.ts — the runtime DOT GTFS spatial lookup.
 */

import {
  lookupDotGtfsFeeds,
  isDotGtfsAvailable,
  __setDotGtfsIndex,
  __clearDotGtfsIndex,
} from '../../src/services/transit/dotGtfsIndex';

const mockIndex = {
  version: 1,
  generatedAt: '2026-05-08T00:00:00Z',
  bucketSize: 0.1,
  buckets: {
    '47.6,-122.4': ['00001:MB', '00040:LR', '00001:FB'],
    '47.6,-122.3': ['00001:MB', '00040:LR'],
    '39.7,-105.0': ['00008:MB'],
    '25.7,-80.2': ['miami:MB'],
  },
  entries: [
    {
      id: '00001:MB',
      ntdId: '00001',
      agencyName: 'King County Metro',
      city: 'Seattle',
      state: 'WA',
      modeName: 'Bus',
      modeAbbr: 'MB',
      uzaName: 'Seattle--Tacoma, WA',
      uzaPop: 3544011,
      weblink: 'https://metro.kingcounty.gov/GTFS/google_transit.zip',
      lat: 47.6062,
      lng: -122.3321,
      dateValidated: '2025-05-27',
      certified: true,
    },
    {
      id: '00040:LR',
      ntdId: '00040',
      agencyName: 'Sound Transit',
      city: 'Seattle',
      state: 'WA',
      modeName: 'Light Rail',
      modeAbbr: 'LR',
      uzaName: 'Seattle--Tacoma, WA',
      uzaPop: 3544011,
      weblink: 'https://www.soundtransit.org/GTFS-rail/40_gtfs.zip',
      lat: 47.6062,
      lng: -122.3321,
      dateValidated: '2025-06-18',
      certified: true,
    },
    {
      id: '00008:MB',
      ntdId: '00008',
      agencyName: 'RTD Denver',
      city: 'Denver',
      state: 'CO',
      modeName: 'Bus',
      modeAbbr: 'MB',
      uzaName: 'Denver--Aurora, CO',
      uzaPop: 2790684,
      weblink: 'https://www.rtd-denver.com/files/gtfs/google_transit.zip',
      lat: 39.7392,
      lng: -104.9903,
      dateValidated: '2025-10-20',
      certified: true,
    },
    {
      id: '00001:FB',
      ntdId: '00001',
      agencyName: 'King County Ferry',
      city: 'Seattle',
      state: 'WA',
      modeName: 'Ferryboat',
      modeAbbr: 'FB',
      uzaName: 'Seattle--Tacoma, WA',
      uzaPop: 3544011,
      weblink: 'https://metro.kingcounty.gov/GTFS/google_transit.zip',
      lat: 47.6062,
      lng: -122.3321,
      dateValidated: '2025-05-27',
      certified: true,
    },
    {
      id: 'miami:MB',
      ntdId: '99999',
      agencyName: 'Miami-Dade Transit',
      city: 'Miami',
      state: 'FL',
      modeName: 'Bus',
      modeAbbr: 'MB',
      uzaName: 'Miami, FL',
      uzaPop: 5582000,
      weblink: 'https://www.miamidade.gov/gtfs.zip',
      lat: 25.7617,
      lng: -80.1918,
      dateValidated: '2026-01-01',
      certified: true,
    },
    {
      id: '00099:MB',
      ntdId: '00099',
      agencyName: 'No URL Agency',
      city: 'Nowhere',
      state: 'WY',
      modeName: 'Bus',
      modeAbbr: 'MB',
      uzaName: '',
      uzaPop: 0,
      weblink: '',
      lat: 44.0,
      lng: -107.0,
      dateValidated: '',
      certified: false,
    },
  ],
};

describe('dotGtfsIndex', () => {
  beforeEach(() => {
    __clearDotGtfsIndex();
    __setDotGtfsIndex(mockIndex);
  });

  afterEach(() => {
    __clearDotGtfsIndex();
  });

  describe('isDotGtfsAvailable', () => {
    it('returns true when index is loaded', async () => {
      const available = await isDotGtfsAvailable();
      expect(available).toBe(true);
    });
  });

  describe('lookupDotGtfsFeeds', () => {
    it('returns matching feeds for Seattle coordinates', async () => {
      const feeds = await lookupDotGtfsFeeds(47.6, -122.33, 1.0);
      expect(feeds.length).toBeGreaterThanOrEqual(2);

      const names = feeds.map((f) => f.agencyName);
      expect(names).toContain('King County Metro');
      expect(names).toContain('Sound Transit');
    });

    it('deduplicates feeds by URL', async () => {
      const feeds = await lookupDotGtfsFeeds(47.6, -122.33, 1.0);
      const urls = feeds.map((f) => f.weblink);
      const uniqueUrls = new Set(urls.filter(Boolean));
      expect(uniqueUrls.size).toBe(urls.filter(Boolean).length);
    });

    it('returns matching feeds for Denver coordinates', async () => {
      const feeds = await lookupDotGtfsFeeds(39.74, -104.99, 1.0);
      expect(feeds.length).toBeGreaterThanOrEqual(1);
      expect(feeds[0].agencyName).toBe('RTD Denver');
    });

    it('sorts by UZA population (largest first)', async () => {
      const feeds = await lookupDotGtfsFeeds(47.6, -122.33, 1.0);
      for (let i = 1; i < feeds.length; i++) {
        expect(feeds[i - 1].uzaPop).toBeGreaterThanOrEqual(feeds[i].uzaPop);
      }
    });

    it('returns empty for coordinates far from any feed', async () => {
      const feeds = await lookupDotGtfsFeeds(0, 0, 0.5);
      expect(feeds).toHaveLength(0);
    });

    it('respects maxFeeds parameter', async () => {
      const feeds = await lookupDotGtfsFeeds(47.6, -122.33, 1.0, 1);
      expect(feeds.length).toBeLessThanOrEqual(1);
    });

    it('excludes feeds without valid URLs', async () => {
      const feeds = await lookupDotGtfsFeeds(44.0, -107.0, 5.0);
      const hasNoUrl = feeds.some((f) => f.agencyName === 'No URL Agency');
      expect(hasNoUrl).toBe(false);
    });

    it('includes feeds in nearby buckets', async () => {
      const feeds = await lookupDotGtfsFeeds(25.7, -80.2, 1.0);
      expect(feeds.length).toBeGreaterThanOrEqual(1);
    });
  });
});
