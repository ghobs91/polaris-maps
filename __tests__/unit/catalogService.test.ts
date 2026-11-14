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

// Mock app config (its module uses syntax the Jest transform cannot parse here;
// the catalog service only needs the URL constant).
jest.mock('../../src/constants/config', () => ({
  REGION_CATALOG_URL: 'https://cdn.example.com/regions/catalog.json',
}));

// Mock region repository
const upsertedRegions: any[] = [];
jest.mock('../../src/services/regions/regionRepository', () => ({
  upsertRegion: async (region: any) => {
    upsertedRegions.push(region);
  },
  getRegionById: async () => null,
}));

// The catalog service reports skipped/malformed entries through the diagnostics
// log, which is MMKV-backed and flushes on a timer — unhandled in this env.
const diagnostics: string[] = [];
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: (_scope: string, _level: string, message: string) => {
    diagnostics.push(message);
  },
}));

beforeEach(() => {
  mockStorage.clear();
  upsertedRegions.length = 0;
  diagnostics.length = 0;
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
          placesUrl: 'https://cdn.example.com/regions/us-new-york/overture-places.geojson.gz',
          placesSizeBytes: 12000000,
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
    expect(upsertedRegions[0].placesUrl).toBe(
      'https://cdn.example.com/regions/us-new-york/overture-places.geojson.gz',
    );
    expect(upsertedRegions[0].placesSizeBytes).toBe(12000000);
  });

  it('does nothing when offline and no cache', async () => {
    await fetchAndSeedCatalog();
    expect(upsertedRegions).toHaveLength(0);
  });

  it('seeds a region whose entry has no version', async () => {
    // The published catalog is generated, and it shipped without a per-region
    // `version` for a while. `regions.version` is NOT NULL, so that insert
    // threw and aborted the whole loop: every install ended up with zero
    // pack-backed regions, auto-download always reported `no-region`, and the
    // regions screen had no packs to offer. Fixtures that always include
    // `version` cannot catch that, so this one deliberately omits it.
    mockStorage.set(
      'region_catalog_v1',
      JSON.stringify({
        version: '1',
        updated_at: '2026-03-18',
        regions: [
          {
            id: 'us-new-york',
            name: 'New York Metro',
            bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 },
            assets: [
              {
                name: 'tiles.pmtiles',
                url: 'https://example.com/us-ny-new-york-tiles.pmtiles',
                sizeBytes: 1000,
              },
            ],
          },
        ],
      }),
    );

    await fetchAndSeedCatalog();

    expect(upsertedRegions).toHaveLength(1);
    expect(upsertedRegions[0].version).toBe('1');
    expect(upsertedRegions[0].assets).toHaveLength(1);
  });

  it('keeps seeding after an entry that cannot be stored', async () => {
    mockStorage.set(
      'region_catalog_v1',
      JSON.stringify({
        version: '1',
        updated_at: '2026-03-18',
        regions: [
          { id: 'broken', name: 'Broken' },
          {
            id: 'us-california',
            name: 'California',
            version: '1',
            bounds: { minLat: 32.5, maxLat: 42.0, minLng: -124.4, maxLng: -114.1 },
          },
        ],
      }),
    );

    await fetchAndSeedCatalog();

    // The malformed entry is skipped, not fatal: the good one still seeds.
    expect(upsertedRegions.map((r) => r.id)).toEqual(['us-california']);
    expect(diagnostics).toContain('skipping malformed catalog region');
  });
});
