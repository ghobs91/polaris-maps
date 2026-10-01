/**
 * Prebuilt SQLite region bundle importer.
 *
 * Verifies the client side of the memory-safe path: the bundle's `places`
 * table is paged, rows are reconstructed into Overture features, and the
 * resulting places are handed to the bulk upsert in bounded batches.
 */

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));
jest.mock('../../src/services/poi/overtureFetcher', () => ({
  importOverturePlacesFromGeoJSON: jest.fn(),
  overtureFeatureToPlace: jest.fn(),
  upsertPlacesInBatches: jest.fn(),
}));

import { importRegionOverturePlacesFromSqlite } from '../../src/services/regions/overtureImporter';
import {
  overtureFeatureToPlace,
  upsertPlacesInBatches,
} from '../../src/services/poi/overtureFetcher';

const SQLite = jest.requireMock('expo-sqlite') as { openDatabaseAsync: jest.Mock };
const featureToPlace = overtureFeatureToPlace as jest.Mock;
const upsertBatches = upsertPlacesInBatches as jest.Mock;

function bundleRow(id: string, name: string, lat: number, lng: number) {
  return {
    id,
    name,
    basic_category: 'cafe',
    category_primary: 'cafe',
    taxonomy_primary: 'food_and_drink',
    taxonomy_hierarchy: null,
    confidence: 0.9,
    operating_status: 'open',
    lng,
    lat,
    addr_freeform: '1 Main St',
    addr_locality: 'New York',
    addr_region: 'NY',
    addr_postcode: '10001',
    addr_country: 'US',
    phone: null,
    website: null,
    brand_wikidata: null,
    brand_name: null,
  };
}

/** A fake source SQLite exposing the two reads the importer performs. */
function makeSourceDb(opts: { table: boolean; total: number; rows: unknown[] }) {
  return {
    getFirstAsync: jest
      .fn()
      .mockResolvedValueOnce(opts.table ? { name: 'places' } : null)
      .mockResolvedValueOnce({ cnt: opts.total }),
    getAllAsync: jest.fn().mockResolvedValueOnce(opts.rows),
    closeAsync: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Pass through: feature carries its row id as the place uuid.
  featureToPlace.mockImplementation((feature: { properties: { id: string } }) => ({
    uuid: feature.properties.id,
  }));
  upsertBatches.mockImplementation(async (batches: AsyncIterable<unknown[]>) => {
    let n = 0;
    for await (const batch of batches) n += batch.length;
    return n;
  });
});

describe('importRegionOverturePlacesFromSqlite', () => {
  it('returns 0 when the bundle has no places table', async () => {
    const src = makeSourceDb({ table: false, total: 0, rows: [] });
    SQLite.openDatabaseAsync.mockResolvedValue(src);

    await expect(importRegionOverturePlacesFromSqlite('file:///b.sqlite')).resolves.toBe(0);
    expect(upsertBatches).not.toHaveBeenCalled();
    expect(src.closeAsync).toHaveBeenCalled();
  });

  it('maps bundle rows to Overture features and bulk-upserts them', async () => {
    const src = makeSourceDb({
      table: true,
      total: 2,
      rows: [
        bundleRow('o1', 'Alpha Cafe', 40.7, -74.0),
        bundleRow('o2', 'Beta Cafe', 40.71, -74.01),
      ],
    });
    SQLite.openDatabaseAsync.mockResolvedValue(src);

    await expect(importRegionOverturePlacesFromSqlite('file:///b.sqlite')).resolves.toBe(2);

    expect(featureToPlace).toHaveBeenCalledTimes(2);
    const feature = featureToPlace.mock.calls[0][0];
    expect(feature.geometry.coordinates).toEqual([-74.0, 40.7]);
    expect(feature.properties.names.primary).toBe('Alpha Cafe');
    expect(feature.properties.categories.primary).toBe('cafe');
    expect(feature.properties.addresses[0].locality).toBe('New York');
  });

  it('filters rows that map to no place', async () => {
    const src = makeSourceDb({
      table: true,
      total: 1,
      rows: [bundleRow('x', 'Unnamed', 40.7, -74.0)],
    });
    SQLite.openDatabaseAsync.mockResolvedValue(src);
    featureToPlace.mockReturnValue(null);

    await expect(importRegionOverturePlacesFromSqlite('file:///b.sqlite')).resolves.toBe(0);
    expect(src.closeAsync).toHaveBeenCalled();
  });
});
