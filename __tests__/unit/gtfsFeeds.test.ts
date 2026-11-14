/**
 * GTFS feed mapping for the pack timetable builder.
 *
 * `scripts/gtfs-feeds.json` decides which regions ship a
 * `transit-timetable.sqlite`, and where that data comes from. Three things are
 * pinned here because each of them fails quietly rather than loudly:
 *
 *  - a region id that is not in the catalog does nothing at all (the build
 *    looks up `matrix.id`),
 *  - a non-https url would be fetched over plain http in CI,
 *  - and an aggregator or mirror url is a policy violation that looks exactly
 *    like a working feed.
 *
 * `feeds` is "verified official"; `candidates` is "official source identified
 * but not verifiable from CI", kept so the next attempt has a starting point.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FeedEntry {
  label: string;
  url: string;
  operator?: string;
  official?: boolean;
  note?: string;
  headers?: Record<string, string>;
  /** Member to take when the url is a bundle of per-mode feeds. */
  extract?: string;
}

interface FeedsFile {
  feeds: Record<string, FeedEntry>;
  candidates: Record<string, FeedEntry & { blocked_by?: string }>;
}

const FEEDS: FeedsFile = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/gtfs-feeds.json'), 'utf8'),
);

/**
 * The hand-maintained metro entries at the top of the catalog.
 *
 * `regions.json` is generated: it carries the curated metro packs first and
 * then every leaf of the Geofabrik tree. Only the curated set is "the 39" that
 * this mapping is about, so the split is read from `curatedCount` rather than
 * hardcoded — the file grows without warning.
 */
const CATALOG = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/regions.json'), 'utf8'),
) as {
  include: Array<{ id: string }>;
  curatedCount: number;
};

const CURATED_REGION_IDS: string[] = CATALOG.include
  .slice(0, CATALOG.curatedCount)
  .map((r) => r.id);

/**
 * Hosts that re-publish or resell someone else's feed. Landing one of these in
 * `feeds` means the region is depending on a third party staying interested,
 * which is the thing the mapping is supposed to avoid.
 */
const AGGREGATOR_HOSTS = [
  'transitfeeds.com',
  'transit.land',
  'mobilitydatabase.org',
  'mkuran.pl',
  'addtransit.com',
  'zbiorkom.live',
  'busone.app',
  'optibus.co',
  'zenbus.net',
  'rushowl.app',
  'busmaps.com',
  'public-transport.earth',
  'storage.googleapis.com',
];

/**
 * Code hosts are not banned outright — LA Metro publishes its own feed from its
 * own GitLab account, which is the authority, not a re-upload. What makes a
 * code host acceptable is that the account belongs to the operator, so the
 * owner is pinned here by hand.
 */
const AGENCY_CODE_HOSTS = ['gitlab.com/LACMTA/'];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const feedEntries = Object.entries(FEEDS.feeds ?? {});
const candidateEntries = Object.entries(FEEDS.candidates ?? {});

describe('gtfs-feeds.json', () => {
  it('only names regions that exist in the catalog', () => {
    const known = new Set(CATALOG.include.map((r) => r.id));
    const unknown = [...feedEntries, ...candidateEntries]
      .map(([id]) => id)
      .filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it('gives every mapped feed a label, an operator and an https url', () => {
    const broken = feedEntries
      .filter(
        ([, feed]) => !feed.label || !feed.operator || !/^https:\/\/\S+$/.test(feed.url ?? ''),
      )
      .map(([id]) => id);
    expect(broken).toEqual([]);
  });

  it('serves every mapped feed from the authority, not an aggregator', () => {
    // `official: false` is the single sanctioned escape hatch and it must carry
    // a written reason — an undocumented mirror is how a pack silently starts
    // depending on a volunteer's server.
    const violations = feedEntries
      .filter(([, feed]) => {
        const host = hostOf(feed.url);
        const isAggregator = AGGREGATOR_HOSTS.some(
          (bad) => host === bad || host.endsWith(`.${bad}`),
        );
        return isAggregator && (feed.official !== false || !feed.note);
      })
      .map(([id, feed]) => `${id}: ${feed.url}`);
    expect(violations).toEqual([]);
  });

  it('only uses a code host when the account belongs to the operator', () => {
    const offences = feedEntries
      .filter(([, feed]) => /(^|\.)(github|gitlab)\.com$/.test(hostOf(feed.url)))
      .filter(
        ([, feed]) => !AGENCY_CODE_HOSTS.some((prefix) => feed.url.startsWith(`https://${prefix}`)),
      )
      .map(([id, feed]) => `${id}: ${feed.url}`);
    expect(offences).toEqual([]);
  });

  it('has at most one undocumented exception', () => {
    const unofficial = feedEntries.filter(([, feed]) => feed.official === false);
    // Not a hard ban — a documented mirror beats no timetable — but it should
    // never quietly grow, so the number is asserted explicitly.
    expect(unofficial.length).toBeLessThanOrEqual(1);
    expect(unofficial.every(([, feed]) => (feed.note ?? '').length > 40)).toBe(true);
  });

  it('keeps candidates out of the build and records why each is blocked', () => {
    const overlap = candidateEntries.map(([id]) => id).filter((id) => id in FEEDS.feeds);
    expect(overlap).toEqual([]);

    const undocumented = candidateEntries
      .filter(([, entry]) => !entry.blocked_by || (entry.blocked_by ?? '').length < 20)
      .map(([id]) => id);
    expect(undocumented).toEqual([]);
  });

  it('documents every curated metro region as either mapped or blocked', () => {
    // A region that is neither mapped nor explained is a gap nobody will find
    // again; this is the assertion that makes the list honest.
    const covered = new Set([
      ...feedEntries.map(([id]) => id),
      ...candidateEntries.map(([id]) => id),
    ]);
    const gaps = CURATED_REGION_IDS.filter((id) => !covered.has(id));
    expect(gaps).toEqual([]);
  });

  it('maps a feed for a majority of the curated regions', () => {
    // Coverage is the deliverable here, so it is asserted rather than assumed.
    // 24 of 39 at the time of writing; the floor moves up, never down.
    expect(feedEntries.length).toBeGreaterThanOrEqual(24);
    expect(feedEntries.length).toBeLessThanOrEqual(CURATED_REGION_IDS.length);
  });

  it('passes per-feed request headers through rather than inventing them', () => {
    // SPTrans 403s a bare curl; the header values must stay non-empty strings
    // or the download silently regresses to the rejected request.
    const bad = feedEntries
      .filter(([, feed]) => feed.headers)
      .filter(([, feed]) =>
        Object.entries(feed.headers ?? {}).some(
          ([key, value]) => !key.trim() || !String(value).trim(),
        ),
      )
      .map(([id]) => id);
    expect(bad).toEqual([]);
  });

  it('names an inner member when the feed is published as a multi-mode bundle', () => {
    // PTV Victoria ships eleven feeds inside one 310 MB archive, so pointing the
    // builder at the url fails outright — and because the timetable step runs
    // before the asset upload, that silently cost Melbourne its whole pack.
    const malformed = feedEntries
      .filter(([, feed]) => feed.extract !== undefined && !/\.zip$/i.test(feed.extract))
      .map(([id]) => id);
    expect(malformed).toEqual([]);

    expect(FEEDS.feeds['au-melbourne']?.extract).toBe('2/google_transit.zip');
  });
});
