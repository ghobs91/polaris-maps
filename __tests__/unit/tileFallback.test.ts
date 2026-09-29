/**
 * Tests for native-safe tile fallback chains (multi-URL raster sources).
 */

import { SATELLITE_STYLE_JSON } from '../../src/constants/satelliteStyle';
import {
  rankedFallbackTileUrls,
  withFallbackTiles,
  withGlobalFallback,
} from '../../src/services/map/tileFallback';
import { IMAGERY_SOURCES } from '../../src/services/map/imagerySources';

const EOX = 'eox.example/{z}/{y}/{x}.jpg';

describe('withFallbackTiles', () => {
  it('keeps priority order and drops duplicates', () => {
    expect(withFallbackTiles(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('skips empty entries', () => {
    expect(withFallbackTiles(['a', ''], ['', 'b'])).toEqual(['a', 'b']);
  });

  it('returns an empty list for empty inputs', () => {
    expect(withFallbackTiles([], [])).toEqual([]);
  });
});

describe('withGlobalFallback', () => {
  it('places the provider first and the global fallback last', () => {
    const tiles = withGlobalFallback(['provider/{z}/{x}/{y}'], [EOX]);
    expect(tiles[0]).toContain('provider');
    expect(tiles[tiles.length - 1]).toContain('eox');
  });
});

describe('rankedFallbackTileUrls', () => {
  it('orders fallback URLs best-source-first for a viewport', () => {
    const urls = rankedFallbackTileUrls([8.4, 47.3, 8.7, 47.5], 16, IMAGERY_SOURCES);
    // Finest covering source (Switzerland) comes before the global base.
    expect(urls[0]).toContain('geo.admin.ch');
    expect(urls.some((u) => u.includes('eox.at'))).toBe(true);
    expect(urls.indexOf(urls.find((u) => u.includes('geo.admin.ch'))!)).toBeLessThan(
      urls.indexOf(urls.find((u) => u.includes('eox.at'))!),
    );
  });
});

describe('satelliteStyle fallback wiring', () => {
  const style = JSON.parse(SATELLITE_STYLE_JSON);

  it('gives the global base a Landsat outage fallback', () => {
    const tiles: string[] = style.sources['satellite-global'].tiles;
    expect(tiles.length).toBe(2);
    expect(tiles[0]).toContain('eox.at');
    expect(tiles[1]).toContain('Landsat');
  });

  it('appends the global base as the fallback for every regional provider', () => {
    const regional = Object.entries(style.sources).filter(([id]) => id.startsWith('ortho-'));
    expect(regional.length).toBeGreaterThan(0);
    for (const [id, source] of regional as [string, { tiles: string[] }][]) {
      expect(source.tiles.length).toBeGreaterThanOrEqual(2);
      const last = source.tiles[source.tiles.length - 1];
      expect(last).toContain('eox.at');
      // The provider's own template stays first.
      expect(source.tiles[0]).not.toContain('eox.at');
      expect(id).toMatch(/^ortho-/);
    }
  });
});
