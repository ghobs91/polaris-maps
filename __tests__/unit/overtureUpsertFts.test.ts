/**
 * Overture upsert → FTS maintenance tests.
 *
 * The search path must not perform a full `places_fts` rebuild; FTS rows are
 * maintained incrementally for exactly the written rowids, with a rebuild
 * only as a consistency recovery.
 */

jest.mock('../../src/services/database/init', () => ({
  getDatabase: jest.fn(),
}));
jest.mock('pmtiles', () => ({ PMTiles: jest.fn() }));
jest.mock('@mapbox/vector-tile', () => ({ VectorTile: jest.fn() }));
jest.mock('pbf', () => jest.fn());
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../../src/constants/config', () => ({
  OVERTURE_PLACES_PM_TILES_URL: '',
}));

import { importOverturePlacesFromGeoJSON } from '../../src/services/poi/overtureFetcher';
import { getDatabase } from '../../src/services/database/init';
import type { OverturePlaceCollection } from '../../src/types/overture';

interface FtsRow {
  rowid: number;
  uuid: string;
  name: string;
  brand_name: string | null;
  category: string;
  address_city: string | null;
}

const NEW_ROW: FtsRow = {
  rowid: 42,
  uuid: 'ov-1',
  name: 'Test Cafe',
  brand_name: null,
  category: 'cafe',
  address_city: 'New York',
};

const OLD_ROW: FtsRow = {
  rowid: 42,
  uuid: 'ov-1',
  name: 'Old Cafe',
  brand_name: null,
  category: 'cafe',
  address_city: 'New York',
};

function makeGeoJSON(): OverturePlaceCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'ov-1',
        geometry: { type: 'Point', coordinates: [-73.985, 40.748] },
        properties: {
          id: 'ov-1',
          names: { primary: 'Test Cafe' },
          categories: { primary: 'cafe' },
          confidence: 1,
        },
      },
    ],
  } as unknown as OverturePlaceCollection;
}

function installDb(opts: {
  existing: FtsRow[];
  written: FtsRow[];
  placesCount: number;
  ftsCount: number;
}) {
  const runAsync = jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
  const getAllAsync = jest
    .fn()
    .mockResolvedValueOnce(opts.existing) // existing-row lookup
    .mockResolvedValueOnce(opts.written); // INSERT ... RETURNING
  const txn = { runAsync, getAllAsync, getFirstAsync: jest.fn() };
  const execAsync = jest.fn().mockResolvedValue(undefined);
  const getFirstAsync = jest
    .fn()
    .mockResolvedValueOnce({ n: opts.placesCount })
    .mockResolvedValueOnce({ n: opts.ftsCount });
  const db = {
    withExclusiveTransactionAsync: jest.fn(async (fn: (txn: unknown) => Promise<void>) => fn(txn)),
    execAsync,
    getFirstAsync,
  };
  (getDatabase as jest.Mock).mockResolvedValue(db);
  return { db, runAsync, getAllAsync, execAsync, getFirstAsync };
}

describe('upsertOverturePlaces FTS maintenance', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('runs no full rebuild on the search path when counts match', async () => {
    const { execAsync, runAsync, getAllAsync } = installDb({
      existing: [],
      written: [NEW_ROW],
      placesCount: 1,
      ftsCount: 1,
    });

    const imported = await importOverturePlacesFromGeoJSON(makeGeoJSON());

    expect(imported).toBe(1);
    const upsertSql = getAllAsync.mock.calls[1][0] as string;
    expect(upsertSql).toContain('RETURNING');
    expect(execAsync).not.toHaveBeenCalledWith(expect.stringContaining("'rebuild'"));

    const ftsInsert = runAsync.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO places_fts(rowid'),
    );
    expect(ftsInsert?.[1]).toEqual([42, 'Test Cafe', null, 'cafe', 'New York']);
  });

  it('deletes old FTS entries before inserting updated ones', async () => {
    const { runAsync } = installDb({
      existing: [OLD_ROW],
      written: [NEW_ROW],
      placesCount: 1,
      ftsCount: 1,
    });

    await importOverturePlacesFromGeoJSON(makeGeoJSON());

    const ftsDelete = runAsync.mock.calls.find(([sql]) => String(sql).includes("'delete'"));
    expect(ftsDelete?.[1]).toEqual([42, 'Old Cafe', null, 'cafe', 'New York']);
  });

  it('falls back to a rebuild when the index row count diverges', async () => {
    const { execAsync } = installDb({
      existing: [],
      written: [NEW_ROW],
      placesCount: 2,
      ftsCount: 1,
    });

    await importOverturePlacesFromGeoJSON(makeGeoJSON());

    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining("'rebuild'"));
  });
});
