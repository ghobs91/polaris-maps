/**
 * Region repository: pack manifest persistence and candidate lookup.
 *
 * Two behaviours, both of which were broken in a way that silently sent every
 * download to OpenFreeMap's capped per-tile path:
 *
 *   1. `Region.assets` was never written to or read from the `regions` table,
 *      so a pack-backed region came back from the database looking pack-less.
 *      `downloadRegion` chooses the pack path from `assets`, so the published
 *      packs were unreachable from every screen.
 *
 *   2. There was no way to ask "which region covers this point and is worth
 *      downloading". `getRegionContainingPoint` filters on
 *      `download_status = 'complete'`, so auto-download could only ever find
 *      areas that were already downloaded — it never started anything.
 *
 * Runs against real SQLite (`node:sqlite`) with the app's schema, the same way
 * `placesInBoundsQuery.test.ts` does.
 */

import { DatabaseSync } from 'node:sqlite';

jest.mock('../../src/services/database/init', () => {
  const db = { getAllAsync: jest.fn(), getFirstAsync: jest.fn(), runAsync: jest.fn() };
  return { getDatabase: jest.fn().mockResolvedValue(db), __mockDb: db };
});

import {
  getPackRegionContainingPoint,
  getRegionContainingPoint,
  upsertRegion,
} from '../../src/services/regions/regionRepository';
import type { Region } from '../../src/models/region';

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init') as {
  __mockDb: {
    getAllAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    runAsync: jest.Mock;
  };
};

/** The `regions` table as `init.ts` creates it, including `assets_json`. */
const SCHEMA = `
  CREATE TABLE regions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bounds_min_lat REAL NOT NULL,
    bounds_max_lat REAL NOT NULL,
    bounds_min_lng REAL NOT NULL,
    bounds_max_lng REAL NOT NULL,
    version TEXT NOT NULL,
    download_status TEXT NOT NULL DEFAULT 'none',
    tiles_size_bytes INTEGER,
    routing_size_bytes INTEGER,
    geocoding_size_bytes INTEGER,
    downloaded_at INTEGER,
    last_updated INTEGER,
    drive_key TEXT,
    geocoding_url TEXT,
    places_url TEXT,
    places_size_bytes INTEGER,
    tile_version TEXT,
    assets_json TEXT
  );
`;

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);

  // expo-sqlite coerces `undefined` to NULL; node:sqlite refuses to bind it.
  const bind = (params: unknown[]) => params.map((v) => (v === undefined ? null : v)) as never[];

  mockDb.runAsync.mockImplementation(async (sql: string, params: unknown[] = []) => {
    db.prepare(sql).run(...bind(params));
  });
  mockDb.getFirstAsync.mockImplementation(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).get(...bind(params)),
  );
  mockDb.getAllAsync.mockImplementation(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(...bind(params)),
  );
});

afterEach(() => db.close());

function region(overrides: Partial<Region> = {}): Region {
  return {
    id: 'us-ny-new-york',
    name: 'New York Metro',
    bounds: { minLat: 40.4, maxLat: 41.1, minLng: -74.5, maxLng: -73.5 },
    version: '1.0',
    downloadStatus: 'none',
    downloadedAt: null,
    ...overrides,
  };
}

const PACK = [
  { name: 'tiles.pmtiles', url: 'https://packs.test/ny/tiles.pmtiles', sizeBytes: 32_000_000 },
  { name: 'search.sqlite', url: 'https://packs.test/ny/search.sqlite', gzip: true },
];

describe('pack manifest persistence', () => {
  it('survives an upsert → read round-trip', async () => {
    // The regression: without this, `assets` is undefined on read and
    // `downloadRegion` silently falls back to the capped tile path.
    await upsertRegion(region({ assets: PACK }));

    const read = await getPackRegionContainingPoint(40.7, -74.0);

    expect(read).not.toBeNull();
    expect(read!.assets).toHaveLength(2);
    expect(read!.assets!.map((a) => a.name)).toEqual(['tiles.pmtiles', 'search.sqlite']);
    expect(read!.assets![0]!.sizeBytes).toBe(32_000_000);
    expect(read!.assets![1]!.gzip).toBe(true);
  });

  it('stores null when a region has no pack', async () => {
    await upsertRegion(region({ id: 'north-america-us-new-york', assets: undefined }));
    const row = db
      .prepare('SELECT assets_json FROM regions WHERE id = ?')
      .get('north-america-us-new-york') as { assets_json: string | null };
    expect(row.assets_json).toBeNull();
  });

  it('degrades a corrupt manifest to no assets instead of throwing', async () => {
    await upsertRegion(region({ assets: PACK }));
    db.prepare('UPDATE regions SET assets_json = ? WHERE id = ?').run(
      '{not json',
      'us-ny-new-york',
    );

    await expect(getPackRegionContainingPoint(40.7, -74.0)).resolves.toBeNull();
  });

  it('drops manifest entries without a name or url', async () => {
    await upsertRegion(
      region({
        assets: [
          { name: 'tiles.pmtiles', url: 'https://packs.test/ny/tiles.pmtiles' },
          { name: 'broken' } as never,
        ],
      }),
    );

    const read = await getPackRegionContainingPoint(40.7, -74.0);
    expect(read!.assets).toHaveLength(1);
    expect(read!.assets![0]!.name).toBe('tiles.pmtiles');
  });
});

describe('getPackRegionContainingPoint', () => {
  it('finds a region that has not been downloaded yet', async () => {
    // The whole point: `getRegionContainingPoint` requires 'complete' and so
    // could never nominate anything to download.
    await upsertRegion(region({ assets: PACK, downloadStatus: 'none' }));

    expect(await getRegionContainingPoint(40.7, -74.0)).toBeNull();
    expect((await getPackRegionContainingPoint(40.7, -74.0))?.id).toBe('us-ny-new-york');
  });

  it('prefers the smallest covering region', async () => {
    await upsertRegion(
      region({
        id: 'north-america-us-new-york',
        name: 'New York State',
        bounds: { minLat: 40.4, maxLat: 45.1, minLng: -79.8, maxLng: -71.8 },
        assets: PACK,
      }),
    );
    await upsertRegion(region({ assets: PACK })); // the metro

    const hit = await getPackRegionContainingPoint(40.7, -74.0);
    expect(hit!.id).toBe('us-ny-new-york');
  });

  it('ignores regions without a pack', async () => {
    await upsertRegion(region({ id: 'north-america-us-new-york', assets: undefined }));
    expect(await getPackRegionContainingPoint(40.7, -74.0)).toBeNull();
  });

  it('ignores regions that do not contain the point', async () => {
    await upsertRegion(region({ assets: PACK }));
    expect(await getPackRegionContainingPoint(51.5, -0.12)).toBeNull(); // London
  });
});
