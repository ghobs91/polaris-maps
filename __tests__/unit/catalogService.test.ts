/**
 * Tests for the region catalog service.
 */

import { getCatalogIds, fetchAndSeedCatalog } from '../../src/services/regions/catalogService';

// Mock MMKV storage
const mockStorage = new Map<string, string>();
jest.mock('../../src/services/storage/mmkv', () => ({
  storage: {
    getString: (key: string) => mockStorage.get(key) ?? undefined,
    set: (key: string, value: string) => mockStorage.set(key, value),
  },
}));

// Mock connectivity
jest.mock('../../src/services/regions/connectivityService', () => ({
  isOnline: () => false,
}));

// Mock region repository
const upsertedRegions: any[] = [];
jest.mock('../../src/services/regions/regionRepository', () => ({
  upsertRegion: async (region: any) => {
    upsertedRegions.push(region);
  },
  getRegionById: async () => null,
}));

beforeEach(() => {
  mockStorage.clear();
  upsertedRegions.length = 0;
});

describe('getCatalogIds', () => {
  it('returns empty array when no cached catalog', () => {
    expect(getCatalogIds()).toEqual([]);
  });

  it('returns region IDs from cached manifest', () => {
    const manifest = {
      version: '1',
      updated_at: '2026-03-18',
      regions: [
        { id: 'us-new-york', name: 'New York' },
        { id: 'us-california', name: 'California' },
      ],
    };
    mockStorage.set('region_catalog_v1', JSON.stringify(manifest));

    expect(getCatalogIds()).toEqual(['us-new-york', 'us-california']);
  });

  it('returns empty array on corrupted cache', () => {
    mockStorage.set('region_catalog_v1', 'not-json!!!');
    expect(getCatalogIds()).toEqual([]);
  });
});

describe('fetchAndSeedCatalog', () => {
  it('seeds from MMKV cache when offline', async () => {
    const manifest = {
      version: '1',
      updated_at: '2026-03-18',
      regions: [
        {
          id: 'us-new-york',
          name: 'New York',
          version: '2026-03-18',
          bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.6 },
          geocodingUrl: 'https://cdn.example.com/regions/us-new-york/geocoding-data.sqlite.gz',
          geocodingSizeBytes: 5000000,
        },
      ],
    };
    mockStorage.set('region_catalog_v1', JSON.stringify(manifest));

    await fetchAndSeedCatalog();

    expect(upsertedRegions).toHaveLength(1);
    expect(upsertedRegions[0].id).toBe('us-new-york');
    expect(upsertedRegions[0].geocodingUrl).toBe(
      'https://cdn.example.com/regions/us-new-york/geocoding-data.sqlite.gz',
    );
  });

  it('does nothing when offline and no cache', async () => {
    await fetchAndSeedCatalog();
    expect(upsertedRegions).toHaveLength(0);
  });
});
