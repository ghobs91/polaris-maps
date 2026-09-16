// searchRanker is pure logic, but imports levenshtein from queryParser
// which itself imports from categoryResolver, so we need same mocks as category tests.
jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));
jest.mock('../../src/services/gun/init', () => ({
  getGun: jest.fn(),
}));
jest.mock('../../src/services/identity/signing', () => ({
  sign: jest.fn(),
  createSigningPayload: jest.fn(),
}));
jest.mock('../../src/services/identity/keypair', () => ({
  getOrCreateKeypair: jest.fn(),
}));

import {
  scoreAndRank,
  deduplicateResults,
  type ScoredResult,
} from '../../src/services/search/searchRanker';
import { parseSearchQuery } from '../../src/services/search/queryParser';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePoi(overrides: Partial<OsmPoi> & { name: string }): OsmPoi {
  return {
    id: Math.floor(Math.random() * 1e9),
    lat: 40.748,
    lng: -73.985,
    type: 'amenity',
    subtype: 'restaurant',
    tags: { name: overrides.name },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scoreAndRank
// ---------------------------------------------------------------------------

describe('scoreAndRank', () => {
  it('ranks exact name matches above partial matches', () => {
    const pois = [
      makePoi({ name: 'Starbucks Reserve Roastery', lat: 40.748, lng: -73.985 }),
      makePoi({ name: 'Starbucks', lat: 40.749, lng: -73.984 }),
    ];
    const parsed = parseSearchQuery('Starbucks');
    const results = scoreAndRank(pois, parsed, 40.748, -73.985);

    expect(results[0].poi.name).toBe('Starbucks');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('ranks closer results higher when text scores tie', () => {
    const pois = [
      makePoi({ name: 'Coffee Shop', lat: 40.8, lng: -73.985 }), // farther
      makePoi({ name: 'Coffee Shop', lat: 40.749, lng: -73.985 }), // closer
    ];
    const parsed = parseSearchQuery('coffee shop');
    const results = scoreAndRank(pois, parsed, 40.748, -73.985);

    // Closer result should rank first
    expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm);
  });

  it('boosts results with matching cuisine tags', () => {
    const pizzeria = makePoi({
      name: 'Joes Pizza',
      tags: { name: 'Joes Pizza', cuisine: 'pizza', amenity: 'restaurant' },
      subtype: 'restaurant',
    });
    const generic = makePoi({
      name: 'Joes Grill',
      tags: { name: 'Joes Grill', amenity: 'restaurant' },
      subtype: 'restaurant',
    });
    const parsed = parseSearchQuery('pizza');
    const results = scoreAndRank([generic, pizzeria], parsed, 40.748, -73.985);

    expect(results[0].poi.name).toBe('Joes Pizza');
  });

  it('gives brand-tagged POIs a popularity boost', () => {
    const branded = makePoi({
      name: 'Starbucks',
      tags: { name: 'Starbucks', brand: 'Starbucks', amenity: 'cafe' },
      subtype: 'cafe',
    });
    const unbranded = makePoi({
      name: 'Starbucks',
      tags: { name: 'Starbucks', amenity: 'cafe' },
      subtype: 'cafe',
      lat: 40.748,
      lng: -73.985,
    });
    const parsed = parseSearchQuery('Starbucks');
    const results = scoreAndRank([unbranded, branded], parsed, 40.748, -73.985);

    // Both should score high, branded slightly higher via popularity
    expect(results[0].poi.tags.brand).toBe('Starbucks');
  });

  it('returns empty array for empty input', () => {
    const parsed = parseSearchQuery('anything');
    expect(scoreAndRank([], parsed, 0, 0)).toHaveLength(0);
  });

  it('ranks an exact-name match far away above a partial-word match nearby', () => {
    // Simulates "tanger outlet deer park" — an exact match 20km away
    // should beat a park that only matches the word "park" 1km away
    const tangerOutlet = makePoi({
      name: 'Tanger Outlet Deer Park',
      lat: 40.762, // ~20km east of reference
      lng: -73.32,
      type: 'shop',
      subtype: 'mall',
      tags: { name: 'Tanger Outlet Deer Park', shop: 'mall' },
    });
    const nearbyPark = makePoi({
      name: 'Giese Park H-20',
      lat: 40.749,
      lng: -73.984,
      type: 'leisure',
      subtype: 'park',
      tags: { name: 'Giese Park H-20', leisure: 'park' },
    });
    const parsed = parseSearchQuery('tanger outlet deer park');
    const results = scoreAndRank([nearbyPark, tangerOutlet], parsed, 40.748, -73.985);

    expect(results[0].poi.name).toBe('Tanger Outlet Deer Park');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('penalizes word matches proportionally to query word coverage', () => {
    // Matching 1 out of 4 words should score much less than matching 4 out of 4
    const pois = [
      makePoi({ name: 'Some Park', lat: 40.749, lng: -73.984 }),
      makePoi({ name: 'Tanger Outlet Deer Park', lat: 40.749, lng: -73.984 }),
    ];
    const parsed = parseSearchQuery('tanger outlet deer park');
    const results = scoreAndRank(pois, parsed, 40.748, -73.985);

    // "Tanger Outlet Deer Park" matches all 4 query words → higher text score
    expect(results[0].poi.name).toBe('Tanger Outlet Deer Park');
  });

  it('includes distanceKm on each result', () => {
    const pois = [makePoi({ name: 'Test', lat: 40.75, lng: -73.99 })];
    const parsed = parseSearchQuery('test');
    const results = scoreAndRank(pois, parsed, 40.748, -73.985);

    expect(results[0].distanceKm).toBeGreaterThan(0);
    expect(typeof results[0].distanceKm).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// deduplicateResults
// ---------------------------------------------------------------------------

describe('deduplicateResults', () => {
  function scored(name: string, lat: number, lng: number, score: number): ScoredResult {
    return {
      poi: makePoi({ name, lat, lng }),
      score,
      distanceKm: 0,
    };
  }

  it('removes duplicate POIs at the same location with identical names', () => {
    const results: ScoredResult[] = [
      scored('Starbucks', 40.748, -73.985, 90),
      scored('Starbucks', 40.7481, -73.9851, 80), // ~15m away, same name
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].score).toBe(90); // keeps highest score
  });

  it('removes duplicates with slightly different names (Levenshtein ≤ 2)', () => {
    const results: ScoredResult[] = [
      scored('Starbucks Coffee', 40.748, -73.985, 90),
      scored("Starbuck's Coffee", 40.7481, -73.9851, 80), // apostrophe stripped
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(1);
  });

  it('keeps distinct POIs that are far apart', () => {
    const results: ScoredResult[] = [
      scored('Starbucks', 40.748, -73.985, 90),
      scored('Starbucks', 40.8, -73.9, 80), // ~6km away
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
  });

  it('keeps POIs with different names at the same location', () => {
    const results: ScoredResult[] = [
      scored('Starbucks', 40.748, -73.985, 90),
      scored('Dunkin', 40.7481, -73.9851, 80),
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateResults([])).toHaveLength(0);
  });

  it('deduplicates by canonical identifier regardless of distance', () => {
    const far: ScoredResult = {
      poi: makePoi({
        name: 'Corner Cafe',
        lat: 40.9,
        lng: -74.2,
        tags: { name: 'Corner Cafe', 'polaris:uuid': 'ov-123' },
      }),
      score: 90,
      distanceKm: 5,
    };
    const near: ScoredResult = {
      poi: makePoi({
        name: 'Corner Cafe',
        lat: 40.748,
        lng: -73.985,
        tags: { name: 'Corner Cafe', 'polaris:uuid': 'ov-123' },
      }),
      score: 80,
      distanceKm: 1,
    };
    expect(deduplicateResults([far, near])).toHaveLength(1);
  });

  it('keeps distinct nearby shops with different canonical identifiers', () => {
    const a: ScoredResult = {
      poi: makePoi({
        name: 'Corner Cafe',
        lat: 40.748,
        lng: -73.985,
        tags: { name: 'Corner Cafe', 'polaris:uuid': 'ov-1' },
      }),
      score: 90,
      distanceKm: 0.01,
    };
    const b: ScoredResult = {
      poi: makePoi({
        name: 'Corner Bakery',
        lat: 40.7481,
        lng: -73.9851,
        tags: { name: 'Corner Bakery', 'polaris:uuid': 'ov-2' },
      }),
      score: 85,
      distanceKm: 0.01,
    };
    expect(deduplicateResults([a, b])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Intent modifiers and score calibration
// ---------------------------------------------------------------------------

describe('intent modifiers', () => {
  it('caps scores at 100', () => {
    const poi = makePoi({
      name: 'Starbucks',
      tags: {
        name: 'Starbucks',
        'polaris:brand': 'Starbucks',
        'polaris:avg_rating': '5',
        'polaris:review_count': '100000',
      },
    });
    const parsed = parseSearchQuery('starbucks');
    const [result] = scoreAndRank([poi], parsed, 40.748, -73.985, {
      viewport: { south: 40.7, north: 40.8, west: -74.0, east: -73.9 },
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThan(90);
  });

  it('demotes places proven closed for "open now" but never excludes them', () => {
    jest.useFakeTimers();
    // Tuesday 12:00 local — the rules below are closed at that time.
    jest.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
    try {
      const open = makePoi({
        name: 'Open Cafe',
        tags: { name: 'Open Cafe', opening_hours: '24/7' },
      });
      const closed = makePoi({
        name: 'Closed Cafe',
        tags: { name: 'Closed Cafe', opening_hours: 'Mo-Su 00:00-06:00' },
      });
      const parsed = parseSearchQuery('open now cafe');
      const results = scoreAndRank([closed, open], parsed, 40.748, -73.985);
      expect(results[0].poi.name).toBe('Open Cafe');
      expect(results).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not demote places with unknown hours', () => {
    const unknown = makePoi({ name: 'Mystery Cafe', tags: { name: 'Mystery Cafe' } });
    const parsed = parseSearchQuery('open now cafe');
    const [result] = scoreAndRank([unknown], parsed, 40.748, -73.985);
    expect(result.score).toBeGreaterThan(0);
  });
});
