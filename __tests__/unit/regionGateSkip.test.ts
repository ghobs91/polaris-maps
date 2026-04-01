/**
 * Tests for the region gate fast-path logic:
 * When downloaded regions exist, the gate should clear immediately
 * without requiring a GPS lookup or bounds check.
 */
import { getDownloadedRegions } from '../../src/services/regions/regionRepository';

// Mock expo-sqlite so getDatabase() never opens a real DB
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('../../src/services/database/init', () => {
  const mockDb = {
    getAllAsync: jest.fn(),
    getFirstAsync: jest.fn(),
    runAsync: jest.fn(),
    execAsync: jest.fn(),
  };
  return {
    getDatabase: jest.fn().mockResolvedValue(mockDb),
    __mockDb: mockDb,
  };
});

const { __mockDb: mockDb } = jest.requireMock('../../src/services/database/init');

describe('Region gate fast-path', () => {
  afterEach(() => jest.clearAllMocks());

  it('getDownloadedRegions returns downloaded regions from SQLite', async () => {
    mockDb.getAllAsync.mockResolvedValue([
      {
        id: 'north-america-us-connecticut',
        name: 'Connecticut',
        bounds_min_lat: 40.98,
        bounds_max_lat: 42.05,
        bounds_min_lng: -73.73,
        bounds_max_lng: -71.79,
        version: '1.0',
        download_status: 'complete',
        tiles_size_bytes: 1024,
        routing_size_bytes: null,
        geocoding_size_bytes: null,
        downloaded_at: 1711936800,
        last_updated: 1711936800,
        drive_key: null,
      },
    ]);

    const regions = await getDownloadedRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBe('north-america-us-connecticut');
    expect(regions[0].downloadStatus).toBe('complete');
  });

  it('getDownloadedRegions returns empty array when no regions downloaded', async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const regions = await getDownloadedRegions();
    expect(regions).toHaveLength(0);
  });

  it('fast-path: downloaded regions should bypass GPS-based bounds check', async () => {
    // This test verifies the contract relied upon by _layout.tsx:
    // If getDownloadedRegions().length > 0, the gate sets 'clear' immediately.
    // We assert that a region with download_status='complete' is returned,
    // which is the exact condition the layout checks before skipping the gate.
    mockDb.getAllAsync.mockResolvedValue([
      {
        id: 'europe-germany-berlin',
        name: 'Berlin',
        bounds_min_lat: 52.33,
        bounds_max_lat: 52.68,
        bounds_min_lng: 13.09,
        bounds_max_lng: 13.76,
        version: '1.0',
        download_status: 'complete',
        tiles_size_bytes: 2048,
        routing_size_bytes: null,
        geocoding_size_bytes: null,
        downloaded_at: 1711936800,
        last_updated: 1711936800,
        drive_key: 'abc123',
      },
    ]);

    const downloaded = await getDownloadedRegions();
    // The layout uses this exact check: downloaded.length > 0 → gate = 'clear'
    expect(downloaded.length > 0).toBe(true);
    expect(downloaded[0].downloadStatus).toBe('complete');
  });
});
