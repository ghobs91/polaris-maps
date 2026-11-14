/**
 * Pack-index / category-mapping drift guard.
 *
 * `scripts/poi-index-shapes.json` decides which OSM features the pack builder
 * indexes. `categoryToOverpassTags` decides which tag pairs the app asks for
 * when a user searches a category. If the two drift, a category search inside a
 * downloaded region silently returns nothing — the pack was never going to have
 * those rows — and the app cannot even tell, because the pack's
 * `poi_index_shapes` table would not list that shape.
 *
 * So: every pair the app can ask for must appear in the build rule. Adding a
 * PlaceCategory without extending the JSON fails here rather than in the field.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DatabaseSync } from 'node:sqlite';

jest.mock('expo-sqlite', () => ({}));
jest.mock('../../src/services/database/init', () => ({ getDatabase: jest.fn() }));

import { categoryToOverpassTags } from '../../src/services/poi/categoryResolver';
import {
  LOCAL_POI_SCHEMA_SQL,
  buildPoiShapeCoverageQuery,
} from '../../src/services/poi/localPoiIndex';
import type { PlaceCategory } from '../../src/models/poi';

interface ShapesFile {
  anyValueKeys: string[];
  namedOptionalPairs: Array<[string, string]>;
}

const SHAPES: ShapesFile = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/poi-index-shapes.json'), 'utf8'),
);

/**
 * Every category the app can search. Kept explicit (not `Object.keys` of
 * something) so a new union member fails to compile here — which is the point.
 */
const ALL_CATEGORIES: PlaceCategory[] = [
  'restaurant',
  'cafe',
  'bar',
  'bakery',
  'fast_food',
  'grocery',
  'supermarket',
  'convenience',
  'pharmacy',
  'hospital',
  'clinic',
  'dentist',
  'bank',
  'atm',
  'post_office',
  'gas_station',
  'ev_charging',
  'parking',
  'hotel',
  'hostel',
  'campground',
  'school',
  'university',
  'library',
  'gym',
  'park',
  'playground',
  'swimming_pool',
  'cinema',
  'museum',
  'theater',
  'clothing',
  'electronics',
  'hardware',
  'bookstore',
  'hair_salon',
  'laundry',
  'car_repair',
  'car_wash',
  'deli',
  'police',
  'fire_station',
  'government',
  'place_of_worship',
  'cemetery',
  'airport',
  'bus_station',
  'train_station',
  'beach',
  'mountain',
  'viewpoint',
  'other',
];

const pairKey = ([key, value]: readonly [string, string]) => `${key}=${value}`;

describe('poi-index-shapes.json', () => {
  it('covers every tag pair the app can ask for by category', () => {
    const indexed = new Set(SHAPES.namedOptionalPairs.map(pairKey));
    const anyValue = new Set(SHAPES.anyValueKeys);

    const uncovered: string[] = [];
    for (const category of ALL_CATEGORIES) {
      // `other` is the unmapped-category bucket: categoryToOverpassTags falls
      // back to `amenity=other`, a tag value that does not exist in OSM, so it
      // asks Overpass for nothing and needs no index shape.
      if (category === 'other') continue;
      for (const pair of categoryToOverpassTags(category)) {
        // A pair whose key is a wildcard key is answered by the "any value of
        // this key, named" shape — but only for named queries, so the pair must
        // still be listed to cover `requireName: false` category searches.
        if (indexed.has(pairKey(pair))) continue;
        uncovered.push(`${category} → ${pairKey(pair)}`);
      }
    }

    expect(uncovered).toEqual([]);
    // Guard against the sets silently becoming useless.
    expect(anyValue.size).toBeGreaterThan(0);
  });

  it('`other` only produces the synthetic fallback pair', () => {
    // Documents the exception above: if a real mapping were added for `other`,
    // this test would notice and the JSON would need the pair.
    expect(categoryToOverpassTags('other')).toEqual([['amenity', 'other']]);
  });

  it('lists no duplicate pairs', () => {
    const keys = SHAPES.namedOptionalPairs.map(pairKey);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it('never uses the wildcard sentinel as a real tag value', () => {
    // '*' is the app's "any value" marker in `poi_index_shapes`; a real tag
    // value of '*' would collide with it.
    for (const [key, value] of SHAPES.namedOptionalPairs) {
      expect(value).not.toBe('*');
      expect(key).not.toBe('*');
    }
  });

  it('indexes the viewport keys, which is what the map POI layer asks for', () => {
    // Mirrors VIEWPORT_POI_KEYS in osmFetcher.ts: a viewport POI query is
    // answered locally only for these keys.
    expect(SHAPES.anyValueKeys).toEqual([
      'amenity',
      'shop',
      'tourism',
      'leisure',
      'office',
      'craft',
      'healthcare',
    ]);
  });

  it('lets the app answer every category from the shapes this config produces', () => {
    // End-to-end contract without needing a built pack: populate the app's
    // shape table exactly as the builder would from this config, then ask the
    // real coverage SQL whether each category's tag pairs are answerable for an
    // unnamed query (category search always passes requireName: false).
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(LOCAL_POI_SCHEMA_SQL);
      db.prepare(
        `INSERT INTO local_poi_coverage (region_id, south, west, north, east, poi_count, updated_at)
         VALUES ('region', -90, -180, 90, 180, 1, 1)`,
      ).run();

      const insertShape = db.prepare(
        `INSERT INTO local_poi_shapes (region_id, key, value, named_only, poi_count)
         VALUES ('region', ?, ?, ?, 0)`,
      );
      for (const key of SHAPES.anyValueKeys) insertShape.run(key, '*', 1);
      for (const [key, value] of SHAPES.namedOptionalPairs) insertShape.run(key, value, 0);

      const bounds = { south: -90, west: -180, north: 90, east: 180 };
      const unanswerable: string[] = [];
      for (const category of ALL_CATEGORIES) {
        if (category === 'other') continue;
        const filters = categoryToOverpassTags(category).map(([key, value]) => ({ key, value }));
        const { sql, params } = buildPoiShapeCoverageQuery(bounds, filters, false);
        const row = db.prepare(sql).get(...params) as { covered: number };
        if (row.covered !== 1) unanswerable.push(category);
      }

      expect(unanswerable).toEqual([]);
    } finally {
      db.close();
    }
  });
});
