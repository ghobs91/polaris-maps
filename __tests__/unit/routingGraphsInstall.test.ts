/**
 * Offline routing graph store: install metadata, target selection, status.
 *
 * These pin the three failure modes that made "no region graph loaded" opaque:
 *
 * 1. Selection used compiled-in catalog bounds that are narrower than the
 *    published ones, so an installed graph did not cover routes it should.
 * 2. A pack spanning the date line downloaded metro graphs it holds no data
 *    for, spending the whole budget on the wrong metros.
 * 3. Every install failure was swallowed, so the route silently degraded to a
 *    network tier with no explanation.
 */

const mockDirs = new Set<string>();
const mockFiles = new Map<string, string>();

// Defined inline: the mock object must carry `__esModule` so `import * as
// FileSystem` in the module under test keeps its named exports.
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  documentDirectory: '/docs/',
  cacheDirectory: '/cache/',
  getInfoAsync: async (uri: string) => ({ exists: mockDirs.has(uri) || mockFiles.has(uri) }),
  makeDirectoryAsync: async (uri: string) => {
    mockDirs.add(uri);
  },
  deleteAsync: async (uri: string) => {
    mockDirs.delete(uri);
    mockFiles.delete(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    mockDirs.delete(from);
    mockDirs.add(to);
  },
  writeAsStringAsync: async (uri: string, data: string) => {
    mockFiles.set(uri, data);
  },
  readAsStringAsync: async (uri: string) => {
    const data = mockFiles.get(uri);
    if (data === undefined) throw new Error(`ENOENT: ${uri}`);
    return data;
  },
}));

const mockExtractTar = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/utils/archiveExtract', () => ({
  extractTar: (...args: unknown[]) => mockExtractTar(...args),
}));

const mockDownloadResumable = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/regions/assetDownload', () => ({
  buildSourceList: (_pack: unknown, urls: string[]) => urls,
  downloadResumable: (...args: unknown[]) => mockDownloadResumable(...args),
}));

jest.mock('../../src/services/regions/mirrorHealth', () => ({
  orderMirrorSources: (urls: string[]) => urls,
  recordMirrorFailure: jest.fn(),
  recordMirrorSuccess: jest.fn(),
}));

jest.mock('../../src/services/regions/catalogService', () => ({
  getCatalogAssetOrigins: () => ({ tag: 'map-data-test', baseUrls: [] }),
}));

const mockGetDownloadedRegions = jest.fn().mockResolvedValue([]);
const mockGetRegionById = jest.fn().mockResolvedValue(null);
jest.mock('../../src/services/regions/regionRepository', () => ({
  getDownloadedRegions: (...args: unknown[]) => mockGetDownloadedRegions(...args),
  getRegionById: (...args: unknown[]) => mockGetRegionById(...args),
}));

import {
  downloadRoutingGraph,
  downloadRoutingGraphsForRegion,
  listInstalledRoutingGraphs,
  pruneUnusedRoutingGraphs,
} from '../../src/services/routing/routingGraphs';
import {
  getRoutingGraphInstallStatus,
  resetRoutingGraphStatus,
  summarizeRoutingGraphProblem,
} from '../../src/services/routing/routingGraphStatus';
import type { Region } from '../../src/models/region';

const NYC_GRAPH_URI = '/docs/regions/_routing/us-ny-new-york/';
const NYC_META_URI = `${NYC_GRAPH_URI}polaris-graph.json`;

// Compiled-in catalog box: ends at -73.7.
const NYC_METRO: Region = {
  id: 'us-ny-new-york',
  name: 'New York Metro',
  bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 },
  version: 'map-data-test',
  downloadStatus: 'none',
  tilesSizeBytes: 1,
  routingSizeBytes: 2,
  geocodingSizeBytes: 3,
  downloadedAt: null,
  lastUpdated: null,
  driveKey: null,
  geocodingUrl: null,
  placesUrl: null,
  placesSizeBytes: null,
  tileVersion: null,
};

beforeEach(() => {
  mockDirs.clear();
  mockFiles.clear();
  jest.clearAllMocks();
  resetRoutingGraphStatus();
  mockDownloadResumable.mockReset();
  mockDownloadResumable.mockResolvedValue(undefined);
  mockExtractTar.mockReset();
  mockExtractTar.mockResolvedValue(undefined);
  mockGetDownloadedRegions.mockResolvedValue([]);
  mockGetRegionById.mockResolvedValue(null);
});

describe('downloadRoutingGraph metadata', () => {
  it('records the published bounds alongside the tiles', async () => {
    // The database row (published catalog) reaches further east than the
    // compiled-in catalog entry.
    mockGetRegionById.mockResolvedValue(NYC_METRO);

    const result = await downloadRoutingGraph('us-ny-new-york');

    expect(result).toEqual({ ok: true });
    const meta = JSON.parse(mockFiles.get(NYC_META_URI)!);
    expect(meta.bounds).toEqual({ minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 });
  });

  it('reports why an install failed instead of returning silently', async () => {
    mockDownloadResumable.mockRejectedValueOnce(new Error('HTTP 404'));

    const result = await downloadRoutingGraph('us-ny-new-york');

    expect(result).toEqual({ ok: false, reason: 'HTTP 404' });
  });
});

describe('listInstalledRoutingGraphs', () => {
  it('widens the compiled-in box with the recorded bounds', async () => {
    mockGetRegionById.mockResolvedValue(NYC_METRO);
    await downloadRoutingGraph('us-ny-new-york');

    const [candidate] = await listInstalledRoutingGraphs();

    expect(candidate.id).toBe('catalog:us-ny-new-york');
    expect(candidate.bounds.maxLng).toBe(-73.2);
  });

  it('falls back to the compiled-in bounds without metadata', async () => {
    // A graph installed by an older build has tiles but no sidecar.
    mockDirs.add(NYC_GRAPH_URI);

    const [candidate] = await listInstalledRoutingGraphs();

    expect(candidate.bounds.maxLng).toBe(-73.7);
  });

  it('ignores a corrupt sidecar', async () => {
    mockDirs.add(NYC_GRAPH_URI);
    mockFiles.set(NYC_META_URI, '{not json');

    const [candidate] = await listInstalledRoutingGraphs();

    expect(candidate.bounds.maxLng).toBe(-73.7);
  });
});

describe('downloadRoutingGraphsForRegion', () => {
  it('tries the pack’s own release tag before the catalog-wide one', async () => {
    const region = {
      ...NYC_METRO,
      assets: [
        {
          name: 'tiles.pmtiles',
          url: 'https://github.com/ghobs91/polaris-maps/releases/download/map-data-2026-11-a/us-ny-new-york-tiles.pmtiles',
        },
      ],
    };
    mockGetRegionById.mockResolvedValue(region);

    await downloadRoutingGraphsForRegion(region);

    const [call] = mockDownloadResumable.mock.calls[0] as [{ sources: string[] }];
    expect(call.sources[0]).toBe(
      'https://github.com/ghobs91/polaris-maps/releases/download/map-data-2026-11-a/us-ny-new-york-routing.tar',
    );
    // The catalog-wide tag is the fallback, not the first try: it does not
    // carry every metro id.
    expect(call.sources).toContain(
      'https://github.com/ghobs91/polaris-maps/releases/download/map-data-test/us-ny-new-york-routing.tar',
    );
  });

  it('skips a date-line-spanning pack and says why', async () => {
    const kiribati: Region = {
      ...NYC_METRO,
      id: 'australia-oceania-kiribati',
      name: 'Kiribati',
      bounds: { minLat: -11.5, maxLat: 3.9, minLng: -175.0, maxLng: 177.0 },
    };

    const status = await downloadRoutingGraphsForRegion(kiribati);

    expect(status.requested).toEqual([]);
    expect(status.skipped).toBe('untrusted-pack-bounds');
    expect(mockDownloadResumable).not.toHaveBeenCalled();
    // The old behaviour downloaded Jakarta, Nairobi and Singapore here.
    expect(mockDirs.size).toBe(0);
  });

  it('reports a partial install, and the badge can explain it', async () => {
    mockGetRegionById.mockResolvedValue(NYC_METRO);
    mockDownloadResumable.mockRejectedValue(new Error('HTTP 404'));

    const status = await downloadRoutingGraphsForRegion(NYC_METRO);

    expect(status.requested).toEqual(['us-ny-new-york']);
    expect(status.installed).toEqual([]);
    expect(status.failed).toEqual([{ id: 'us-ny-new-york', reason: 'HTTP 404' }]);
    expect(getRoutingGraphInstallStatus()).not.toBeNull();
    expect(summarizeRoutingGraphProblem()).toBe(
      'graph install failed for us-ny-new-york: HTTP 404',
    );
  });

  it('installs the graph and records no problem', async () => {
    mockGetRegionById.mockResolvedValue(NYC_METRO);

    const status = await downloadRoutingGraphsForRegion(NYC_METRO);

    expect(status.installed).toEqual(['us-ny-new-york']);
    expect(status.failed).toEqual([]);
    expect(summarizeRoutingGraphProblem()).toBeNull();
    expect(mockDirs.has(NYC_GRAPH_URI)).toBe(true);
  });
});

describe('pruneUnusedRoutingGraphs', () => {
  it('keeps a graph whose recorded bounds still overlap a downloaded region', async () => {
    mockGetRegionById.mockResolvedValue(NYC_METRO);
    await downloadRoutingGraph('us-ny-new-york');
    mockGetDownloadedRegions.mockResolvedValue([NYC_METRO]);

    await pruneUnusedRoutingGraphs();

    expect(mockDirs.has(NYC_GRAPH_URI)).toBe(true);
  });

  it('removes a graph no downloaded region overlaps', async () => {
    mockGetRegionById.mockResolvedValue(NYC_METRO);
    await downloadRoutingGraph('us-ny-new-york');
    mockGetDownloadedRegions.mockResolvedValue([
      {
        ...NYC_METRO,
        id: 'jp-tokyo',
        bounds: { minLat: 35.5, maxLat: 35.9, minLng: 139.5, maxLng: 139.9 },
      },
    ]);

    await pruneUnusedRoutingGraphs();

    expect(mockDirs.has(NYC_GRAPH_URI)).toBe(false);
  });
});
