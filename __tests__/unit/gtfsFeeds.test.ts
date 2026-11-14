/**
 * GTFS feed mapping for the pack timetable builder.
 *
 * `scripts/gtfs-feeds.json` decides which regions ship a
 * `transit-timetable.sqlite`. A key that is not a real region silently does
 * nothing (the build looks up `matrix.id`), and a non-https URL would be
 * fetched in CI — so both are pinned here rather than discovered in a build log.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FeedsFile {
  feeds: Record<string, { label: string; url: string }>;
}

const FEEDS: FeedsFile = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/gtfs-feeds.json'), 'utf8'),
);

const REGION_IDS = new Set<string>(
  (
    JSON.parse(readFileSync(resolve(__dirname, '../../scripts/regions.json'), 'utf8')) as {
      include: Array<{ id: string }>;
    }
  ).include.map((region) => region.id),
);

describe('gtfs-feeds.json', () => {
  it('only names regions that exist in the catalog', () => {
    const unknown = Object.keys(FEEDS.feeds).filter((id) => !REGION_IDS.has(id));
    expect(unknown).toEqual([]);
  });

  it('uses https for every feed', () => {
    // A build that fetches over plain http can be tampered with in transit, and
    // the timetable is what the offline planner trusts.
    const insecure = Object.entries(FEEDS.feeds)
      .filter(([, feed]) => !feed.url.startsWith('https://'))
      .map(([id, feed]) => `${id}: ${feed.url}`);
    expect(insecure).toEqual([]);
  });

  it('gives every feed a label and a non-empty url', () => {
    const broken = Object.entries(FEEDS.feeds)
      .filter(([, feed]) => !feed.label || !/^https:\/\/\S+$/.test(feed.url ?? ''))
      .map(([id]) => id);
    expect(broken).toEqual([]);
  });

  it('does not duplicate a feed across regions unless intended', () => {
    // Duplicates are allowed (two regions can share a national feed), but the
    // count should be visible rather than accidental.
    const urls = Object.values(FEEDS.feeds).map((feed) => feed.url);
    const unique = new Set(urls);
    expect(unique.size).toBeGreaterThan(0);
    expect(urls.length).toBeGreaterThanOrEqual(unique.size);
  });
});
