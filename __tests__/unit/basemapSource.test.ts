/**
 * Basemap source override.
 *
 * The default vector basemap is a single free service from a company with no
 * SLA, and there is no public-interest drop-in replacement for the
 * OpenMapTiles schema. The mitigation is being able to point elsewhere without
 * an App Store release — which means the override has to be safe: https only,
 * scoped to the vector source, and inert when absent.
 */

jest.mock('../../src/services/diagnostics/diagnosticsLog', () => ({ logDiagnostic: jest.fn() }));

import {
  applyBasemapSource,
  getBasemapTilesUrl,
  isUsableBasemapUrl,
  setBasemapTilesUrl,
  __resetBasemapSourceForTests,
} from '../../src/services/map/basemapSource';

const STYLE = JSON.stringify({
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    satellite: { type: 'raster', tiles: ['https://example.test/{z}/{x}/{y}.jpg'] },
  },
  layers: [{ id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' }],
});

describe('basemap source override', () => {
  beforeEach(() => __resetBasemapSourceForTests());

  it('leaves the style untouched when no override is set', () => {
    // Identity, not a re-stringify: this is the hot path on every style resolve.
    expect(applyBasemapSource(STYLE)).toBe(STYLE);
    expect(getBasemapTilesUrl()).toBeNull();
  });

  it('repoints the vector basemap source', () => {
    setBasemapTilesUrl('https://packs.example.test/planet/tilejson.json');
    const parsed = JSON.parse(applyBasemapSource(STYLE));
    expect(parsed.sources.openmaptiles.url).toBe('https://packs.example.test/planet/tilejson.json');
  });

  it('does not touch non-vector sources', () => {
    setBasemapTilesUrl('https://packs.example.test/planet/tilejson.json');
    const parsed = JSON.parse(applyBasemapSource(STYLE));
    expect(parsed.sources.satellite.tiles[0]).toBe('https://example.test/{z}/{x}/{y}.jpg');
  });

  it('rejects non-https and unparseable overrides', () => {
    for (const bad of ['http://insecure.test/t.json', 'not a url', 'ftp://x.test/t.json']) {
      expect(isUsableBasemapUrl(bad)).toBe(false);
      setBasemapTilesUrl(bad);
      expect(getBasemapTilesUrl()).toBeNull();
      expect(applyBasemapSource(STYLE)).toBe(STYLE);
    }
  });

  it('clears the override when the config omits it', () => {
    setBasemapTilesUrl('https://packs.example.test/planet/tilejson.json');
    setBasemapTilesUrl(undefined);
    expect(getBasemapTilesUrl()).toBeNull();
    expect(applyBasemapSource(STYLE)).toBe(STYLE);
  });

  it('ignores a style with no vector source', () => {
    setBasemapTilesUrl('https://packs.example.test/planet/tilejson.json');
    const rasterOnly = JSON.stringify({ version: 8, sources: { a: { type: 'raster' } } });
    expect(applyBasemapSource(rasterOnly)).toBe(rasterOnly);
  });

  it('survives a style that is not JSON', () => {
    setBasemapTilesUrl('https://packs.example.test/planet/tilejson.json');
    expect(applyBasemapSource('{not json')).toBe('{not json');
  });
});
