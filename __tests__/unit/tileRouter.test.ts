/**
 * Unit tests for the satellite tile routing engine.
 *
 * Verifies resolution ranking, recency tie-breaking, spatial/zoom filtering,
 * fallback ordering, and the STAC metadata cache.
 */

import {
  createTileMetadataCache,
  rankImagerySources,
  selectBestTileSource,
  sourceSupportsZoom,
  type BBox,
  type ImagerySource,
} from '../../src/services/map/tileRouter';
import {
  IMAGERY_SOURCES,
  OAM_STAC_SEARCH_URL,
  selectBestImagerySource,
} from '../../src/services/map/imagerySources';

const GLOBAL: BBox = [-180, -85, 180, 85];

function makeSource(overrides: Partial<ImagerySource> & { id: string }): ImagerySource {
  return {
    label: overrides.id,
    kind: 'ortho',
    tiles: [`https://example.test/${overrides.id}/{z}/{x}/{y}.png`],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 19,
    resolutionM: 0.5,
    acquiredAt: '2020-01-01',
    attribution: 'test',
    bounds: null,
    ...overrides,
  };
}

describe('tileRouter — resolution ranking', () => {
  it('ranks finer resolution ahead of coarser resolution', () => {
    const sources = [
      makeSource({ id: 'coarse', resolutionM: 10 }),
      makeSource({ id: 'fine', resolutionM: 0.1 }),
      makeSource({ id: 'medium', resolutionM: 0.3 }),
    ];
    const ranked = rankImagerySources(GLOBAL, 10, sources);
    expect(ranked.map((s) => s.id)).toEqual(['fine', 'medium', 'coarse']);
  });

  it('uses recency to break ties within the resolution tolerance', () => {
    const sources = [
      makeSource({ id: 'old', resolutionM: 0.1, acquiredAt: '2015-01-01' }),
      makeSource({ id: 'new', resolutionM: 0.105, acquiredAt: '2025-01-01' }),
    ];
    const ranked = rankImagerySources(GLOBAL, 10, sources);
    expect(ranked.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('prefers a finer source even if a coarser one is newer (outside tolerance)', () => {
    const sources = [
      makeSource({ id: 'fine-old', resolutionM: 0.1, acquiredAt: '2012-01-01' }),
      makeSource({ id: 'coarse-new', resolutionM: 0.2, acquiredAt: '2026-01-01' }),
    ];
    const ranked = rankImagerySources(GLOBAL, 10, sources);
    expect(ranked[0].id).toBe('fine-old');
  });

  it('is deterministic when resolution and recency are equal (id tie-break)', () => {
    const sources = [
      makeSource({ id: 'b', resolutionM: 0.3 }),
      makeSource({ id: 'a', resolutionM: 0.3 }),
    ];
    expect(rankImagerySources(GLOBAL, 10, sources).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('tileRouter — filtering', () => {
  it('excludes sources whose bounds do not intersect the viewport', () => {
    const spain = makeSource({ id: 'es', bounds: [-9.5, 35.9, 4.5, 43.9] });
    const nz = makeSource({ id: 'nz', bounds: [166.3, -47.5, 178.7, -34.1] });
    const ranked = rankImagerySources([-3.8, 40.3, -3.6, 40.5], 15, [spain, nz]);
    expect(ranked.map((s) => s.id)).toEqual(['es']);
  });

  it('always includes global sources (bounds null)', () => {
    const ranked = rankImagerySources([-3.8, 40.3, -3.6, 40.5], 15, [
      makeSource({ id: 'global', bounds: null }),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['global']);
  });

  it('excludes sources that would over-zoom too far past their max zoom', () => {
    const modis = makeSource({ id: 'modis', maxzoom: 9, resolutionM: 250 });
    expect(sourceSupportsZoom(modis, 11)).toBe(true); // within +2
    expect(sourceSupportsZoom(modis, 14)).toBe(false); // too far
    expect(rankImagerySources(GLOBAL, 14, [modis])).toEqual([]);
  });
});

describe('tileRouter — fallback queue and selection', () => {
  it('returns the best source plus an ordered fallback queue', () => {
    const sources = [
      makeSource({ id: 'a', resolutionM: 0.5 }),
      makeSource({ id: 'b', resolutionM: 0.1 }),
      makeSource({ id: 'c', resolutionM: 10 }),
    ];
    const { selected, ranked } = selectBestTileSource(GLOBAL, 12, sources);
    expect(selected?.id).toBe('b');
    expect(ranked.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns null when nothing can serve the viewport', () => {
    const { selected, ranked } = selectBestTileSource([0, 0, 1, 1], 5, []);
    expect(selected).toBeNull();
    expect(ranked).toEqual([]);
  });
});

describe('imagerySources registry integration', () => {
  it('selects a regional ortho over the global base for a covered viewport', () => {
    // Zurich at z16.
    const zurich: BBox = [8.4, 47.3, 8.7, 47.5];
    const { selected } = selectBestImagerySource(zurich, 16);
    expect(selected?.id).toBe('ortho-ch');
  });

  it('falls back to a global satellite source where no ortho covers', () => {
    // Mid-Pacific at z5.
    const { selected } = selectBestImagerySource([-160, 10, -150, 20], 5);
    expect(selected?.bounds === null).toBe(true);
    expect(['eox-s2cloudless', 'oam']).toContain(selected?.id);
  });

  it('registers the brief providers (OAM, NAIP, Landsat, GIBS, Sentinel-2)', () => {
    const ids = IMAGERY_SOURCES.map((s) => s.id);
    for (const id of ['oam', 'usgs-naip', 'gibs-landsat', 'gibs-modis', 'eox-s2cloudless']) {
      expect(ids).toContain(id);
    }
    expect(OAM_STAC_SEARCH_URL).toContain('stac/search');

    const oam = IMAGERY_SOURCES.find((s) => s.id === 'oam');
    expect(oam?.tiles[0]).toContain('openaerialmap');
    expect(oam?.tiles[0]).toContain('{z}/{x}/{y}');
  });

  it('marks key-gated providers with env-sourced auth', () => {
    const fi = IMAGERY_SOURCES.find((s) => s.id === 'ortho-fi');
    const linz = IMAGERY_SOURCES.find((s) => s.id === 'ortho-nz');
    expect(fi?.auth?.[0]?.envVar).toBe('EXPO_PUBLIC_FI_MML_API_KEY');
    expect(linz?.auth?.[0]?.name).toBe('api');
  });
});

describe('createTileMetadataCache', () => {
  it('stores and retrieves values', () => {
    const cache = createTileMetadataCache<number>();
    cache.set('k', 1);
    expect(cache.get('k')).toBe(1);
    expect(cache.has('k')).toBe(true);
  });

  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = createTileMetadataCache<number>({ ttlMs: 100, now: () => now });
    cache.set('k', 1);
    now = 99;
    expect(cache.get('k')).toBe(1);
    now = 101;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('evicts the least-recently-used entry past the max size', () => {
    const cache = createTileMetadataCache<number>({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh a
    cache.set('c', 3); // should evict b
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
