/**
 * Region asset plumbing: placeholder detection + catalog URL stamping.
 *
 * Two failure modes this covers:
 *  - a release build pointing at `cdn.example.com`, which fails *quietly*
 *    because catalog fetch is best-effort;
 *  - a published build whose packs have index assets that no catalog entry
 *    references, so downloads never fetch them.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

jest.mock('expo-sqlite', () => ({}));
jest.mock('expo-location', () => ({}));
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({
  logDiagnostic: jest.fn(),
}));

import {
  isPlaceholderUrl,
  isRegionCatalogConfigured,
} from '../../src/services/regions/catalogService';

const SCRIPT = resolve(__dirname, '../../scripts/update-region-asset-urls.mjs');

describe('placeholder detection', () => {
  it('flags documented placeholder hosts', () => {
    expect(isPlaceholderUrl('https://cdn.example.com/regions/catalog.json')).toBe(true);
    expect(isPlaceholderUrl('https://example.org/x')).toBe(true);
    expect(isPlaceholderUrl('https://static.example.net/y')).toBe(true);
  });

  it('accepts real community / third-party origins', () => {
    expect(
      isPlaceholderUrl(
        'https://github.com/ghobs91/polaris-maps/releases/download/map-data-2026-01/x',
      ),
    ).toBe(false);
    expect(
      isPlaceholderUrl(
        'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-09-23.1/places.pmtiles',
      ),
    ).toBe(false);
  });

  it('treats missing or unparseable URLs as unconfigured', () => {
    expect(isPlaceholderUrl(null)).toBe(true);
    expect(isPlaceholderUrl(undefined)).toBe(true);
    expect(isPlaceholderUrl('not a url')).toBe(true);
  });

  it('reports the shipped catalog default as unconfigured', () => {
    // The repository default is still a placeholder; a release build must set
    // EXPO_PUBLIC_REGION_CATALOG_URL to a real origin.
    expect(isRegionCatalogConfigured('https://cdn.example.com/regions/catalog.json')).toBe(false);
    expect(isRegionCatalogConfigured('https://packs.some-community-host.net/catalog.json')).toBe(
      true,
    );
  });
});

describe('update-region-asset-urls.mjs', () => {
  let dir: string;
  let catalogPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'polaris-catalog-'));
    catalogPath = join(dir, 'regions.json');
    writeFileSync(
      catalogPath,
      JSON.stringify({
        include: [
          { id: 'us-ny-new-york', name: 'New York Metro', bbox: '-74.3,40.4,-73.2,41.0' },
          { id: 'jp-tokyo', name: 'Tokyo', bbox: '139.5,35.5,140.0,35.9' },
        ],
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stamps index URLs for every region, preserving other fields', () => {
    execFileSync(
      process.execPath,
      [SCRIPT, '--tag', 'map-data-2026-01', '--catalog', catalogPath],
      {
        stdio: 'pipe',
      },
    );

    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      include: Array<Record<string, unknown>>;
    };

    const ny = catalog.include[0]!;
    expect(ny.name).toBe('New York Metro');
    expect(ny.bbox).toBe('-74.3,40.4,-73.2,41.0');
    expect(ny.searchIndexUrl).toBe(
      'https://github.com/ghobs91/polaris-maps/releases/download/map-data-2026-01/us-ny-new-york-search.sqlite',
    );
    expect(ny.transitIndexUrl).toContain('us-ny-new-york-transit.sqlite');
    expect(catalog.include[1]!.transitIndexUrl).toContain('jp-tokyo-transit.sqlite');

    // Sizes are unknown here, so they must not be invented.
    expect(ny.searchIndexSizeBytes).toBeUndefined();
  });

  it('applies sizes when a sizes file is supplied', () => {
    const sizesPath = join(dir, 'sizes.json');
    writeFileSync(
      sizesPath,
      JSON.stringify({
        'us-ny-new-york': { searchIndexSizeBytes: 12_345, transitIndexSizeBytes: 678 },
      }),
    );

    execFileSync(
      process.execPath,
      [SCRIPT, '--tag', 'map-data-2026-01', '--catalog', catalogPath, '--sizes', sizesPath],
      { stdio: 'pipe' },
    );

    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      include: Array<Record<string, unknown>>;
    };
    expect(catalog.include[0]!.searchIndexSizeBytes).toBe(12_345);
    expect(catalog.include[0]!.transitIndexSizeBytes).toBe(678);
    expect(catalog.include[1]!.searchIndexSizeBytes).toBeUndefined();
  });

  it('drops regions whose pack is not in the release when assets are supplied', () => {
    const assetsPath = join(dir, 'assets.json');
    writeFileSync(assetsPath, JSON.stringify(['us-ny-new-york-routing.tar']));

    execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--tag',
        'map-data-2026-01',
        '--catalog',
        catalogPath,
        '--out',
        join(dir, 'catalog.json'),
        '--assets',
        assetsPath,
      ],
      { stdio: 'pipe' },
    );

    const published = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8')) as {
      regions: Array<{ id: string }>;
    };
    expect(published.regions.map((region) => region.id)).toEqual(['us-ny-new-york']);
  });

  it('publishes the app catalog shape (regions, version, updated_at + origins)', () => {
    execFileSync(
      process.execPath,
      [SCRIPT, '--tag', 'map-data-2026-01', '--catalog', catalogPath, '--out', join(dir, 'c.json')],
      { stdio: 'pipe' },
    );
    const published = JSON.parse(readFileSync(join(dir, 'c.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(published).sort()).toEqual([
      'assetBaseUrls',
      'assetTag',
      'regions',
      'updated_at',
      'version',
    ]);
    expect((published.regions as unknown[]).length).toBe(2);
    // The tag travels with the catalog so mirrors work without a GitHub API call.
    expect(published.assetTag).toBe('map-data-2026-01');
    expect(published.assetBaseUrls).toEqual([
      'https://github.com/ghobs91/polaris-maps/releases/download',
    ]);
  });

  it('stamps every mirror onto each asset and records the origin list', () => {
    execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--tag',
        'map-data-2026-01',
        '--catalog',
        catalogPath,
        '--out',
        join(dir, 'c-mirrors.json'),
        '--mirror',
        'r2=https://packs.example-r2.dev',
        '--mirror',
        'b2=https://packs.s3.us-west-004.backblazeb2.com',
        '--mirror',
        'ia=https://archive.org/download/polaris-packs',
      ],
      { stdio: 'pipe' },
    );

    const published = JSON.parse(readFileSync(join(dir, 'c-mirrors.json'), 'utf8')) as {
      assetBaseUrls: string[];
      regions: Array<{ assets: Array<{ name: string; url: string; mirrors?: string[] }> }>;
    };

    expect(published.assetBaseUrls).toEqual([
      'https://github.com/ghobs91/polaris-maps/releases/download',
      'https://packs.example-r2.dev',
      'https://packs.s3.us-west-004.backblazeb2.com',
      'https://archive.org/download/polaris-packs',
    ]);

    const tiles = published.regions[0]!.assets.find((a) => a.name === 'tiles.pmtiles')!;
    expect(tiles.url).toContain('github.com/ghobs91/polaris-maps/releases/download');
    expect(tiles.mirrors).toEqual([
      'https://packs.example-r2.dev/map-data-2026-01/us-ny-new-york-tiles.pmtiles',
      'https://packs.s3.us-west-004.backblazeb2.com/map-data-2026-01/us-ny-new-york-tiles.pmtiles',
      'https://archive.org/download/polaris-packs/map-data-2026-01/us-ny-new-york-tiles.pmtiles',
    ]);
  });

  it('accepts the comma-separated --mirrors form for backwards compatibility', () => {
    execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--tag',
        't1',
        '--catalog',
        catalogPath,
        '--out',
        join(dir, 'c-compat.json'),
        '--mirrors',
        'https://a.example.org/,https://b.example.org',
      ],
      { stdio: 'pipe' },
    );
    const published = JSON.parse(readFileSync(join(dir, 'c-compat.json'), 'utf8')) as {
      assetBaseUrls: string[];
    };
    expect(published.assetBaseUrls).toEqual([
      'https://github.com/ghobs91/polaris-maps/releases/download',
      'https://a.example.org',
      'https://b.example.org',
    ]);
  });

  it('honours a custom base origin and does not rewrite the file on --dry-run', () => {
    const before = readFileSync(catalogPath, 'utf8');
    const out = execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--tag',
        't1',
        '--catalog',
        catalogPath,
        '--base',
        'https://packs.community-host.net/regions/',
        '--dry-run',
      ],
      { stdio: 'pipe' },
    ).toString();

    expect(out).toContain(
      'https://packs.community-host.net/regions/t1/us-ny-new-york-search.sqlite',
    );
    expect(out.startsWith('{')).toBe(true);
    expect(readFileSync(catalogPath, 'utf8')).toBe(before);
  });
});

/**
 * Per-asset sizes and existence filtering.
 *
 * Both were missing from the published catalog, and both break auto-download:
 * `decideAutoDownload` refuses to start without a size (`size-unknown`), and an
 * asset entry the release does not carry is a guaranteed 404 mid-download.
 */
describe('per-asset sizes and availability', () => {
  let dir: string;
  let catalogPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'polaris-asset-sizes-'));
    catalogPath = join(dir, 'regions.json');
    writeFileSync(
      catalogPath,
      JSON.stringify({ include: [{ id: 'us-ny-new-york', name: 'New York Metro' }] }),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function stamp(extraArgs: string[]): Record<string, unknown> {
    const out = join(dir, 'catalog.json');
    execFileSync(
      process.execPath,
      [SCRIPT, '--tag', 'map-data-2026-11', '--catalog', catalogPath, '--out', out, ...extraArgs],
      { stdio: 'pipe' },
    );
    return JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
  }

  function assetsOf(catalog: Record<string, unknown>): Array<{ name: string; sizeBytes?: number }> {
    const regions = catalog.regions as Array<{ id: string; assets: Array<{ name: string }> }>;
    return regions.find((r) => r.id === 'us-ny-new-york')!.assets as Array<{
      name: string;
      sizeBytes?: number;
    }>;
  }

  it('fills sizeBytes from the release asset list', () => {
    const sizesPath = join(dir, 'asset-sizes.json');
    writeFileSync(
      sizesPath,
      JSON.stringify({
        'us-ny-new-york-tiles.pmtiles': 77_822_320,
        'us-ny-new-york-search.sqlite': 50_429_952,
      }),
    );
    const assetsPath = join(dir, 'assets.json');
    writeFileSync(
      assetsPath,
      JSON.stringify([
        'us-ny-new-york-routing.tar',
        'us-ny-new-york-tiles.pmtiles',
        'us-ny-new-york-search.sqlite',
      ]),
    );

    const catalog = stamp(['--asset-sizes', sizesPath, '--assets', assetsPath]);

    const assets = assetsOf(catalog);
    expect(assets.find((a) => a.name === 'tiles.pmtiles')!.sizeBytes).toBe(77_822_320);
    expect(assets.find((a) => a.name === 'search.sqlite')!.sizeBytes).toBe(50_429_952);
  });

  it('drops assets the release does not carry', () => {
    // The published catalog advertised a transit-timetable URL that was never
    // uploaded, so that fetch could only 404.
    const assetsPath = join(dir, 'assets.json');
    writeFileSync(
      assetsPath,
      JSON.stringify([
        'us-ny-new-york-routing.tar',
        'us-ny-new-york-tiles.pmtiles',
        'us-ny-new-york-search.sqlite',
      ]),
    );

    const catalog = stamp(['--assets', assetsPath]);

    expect(assetsOf(catalog).map((a) => a.name)).toEqual(['tiles.pmtiles', 'search.sqlite']);
  });

  it('leaves the manifest alone when no asset list is given', () => {
    // Without `--assets` there is nothing to filter against, so every declared
    // asset stays (and simply has no size).
    const catalog = stamp([]);
    expect(assetsOf(catalog).length).toBeGreaterThan(0);
  });
});
