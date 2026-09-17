/**
 * Integration test for the bundled DOT GTFS spatial index: load the real
 * `dot-gtfs-index.json` (no mock) and confirm Seattle resolves to its agencies.
 */

import {
  isDotGtfsAvailable,
  lookupDotGtfsFeeds,
  getDotGtfsFeedByNtdId,
} from '../../src/services/transit/dotGtfsIndex';

describe('DOT GTFS index (bundled)', () => {
  it('is bundled and loadable', async () => {
    await expect(isDotGtfsAvailable()).resolves.toBe(true);
  });

  it('returns Seattle-area agencies for Seattle coordinates', async () => {
    const feeds = await lookupDotGtfsFeeds(47.6062, -122.3321, 0.5, 8);

    expect(feeds.length).toBeGreaterThan(0);
    const names = feeds.map((f) => f.agencyName);
    expect(names).toEqual(
      expect.arrayContaining(['King County', 'Central Puget Sound Regional Transit Authority']),
    );
    // Every returned feed carries a usable feed URL.
    for (const feed of feeds) {
      expect(feed.weblink).toMatch(/^https?:\/\//);
    }
  });

  it('resolves a known agency by NTD id', async () => {
    const feeds = await lookupDotGtfsFeeds(47.6062, -122.3321, 0.5, 1);
    const feed = await getDotGtfsFeedByNtdId(feeds[0].ntdId);

    expect(feed?.agencyName).toBe(feeds[0].agencyName);
  });

  it('returns nothing for an ocean coordinate', async () => {
    await expect(lookupDotGtfsFeeds(0, -140, 0.1)).resolves.toHaveLength(0);
  });
});
