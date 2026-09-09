import { buildOfflineStyle, OFFLINE_PACK_MAXZOOM } from '../../src/services/map/offlineStyle';

const OPTS = {
  sourceId: 'offline-nyc-metro',
  tileBaseUrl: 'http://127.0.0.1:51234',
  fallbackBackground: '#101418',
};

function vectorStyle(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 8,
    name: 'test',
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000' } }],
    ...extra,
  });
}

describe('buildOfflineStyle', () => {
  it('rewrites vector sources to the loopback tile server', () => {
    const out = buildOfflineStyle(vectorStyle(), OPTS);
    expect(out).not.toBeNull();
    const style = JSON.parse(out!);
    expect(style.sources.openmaptiles).toMatchObject({
      type: 'vector',
      tiles: ['http://127.0.0.1:51234/offline-nyc-metro/{z}/{x}/{y}.pbf'],
      maxzoom: OFFLINE_PACK_MAXZOOM,
    });
    expect(style.sources.openmaptiles.url).toBeUndefined();
    // Remote glyphs are kept — labels work on poor links, fail silently offline.
    expect(style.glyphs).toContain('tiles.openfreemap.org');
  });

  it('drops online raster sources and their layers, injecting a background', () => {
    const base = JSON.stringify({
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/.../{z}/{y}/{x}'],
          tileSize: 256,
        },
        openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      },
      layers: [
        { id: 'satellite-tiles', type: 'raster', source: 'satellite' },
        { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
      ],
    });
    const style = JSON.parse(buildOfflineStyle(base, OPTS)!);
    expect(style.sources.satellite).toBeUndefined();
    expect(style.layers.some((l: { id: string }) => l.id === 'satellite-tiles')).toBe(false);
    expect(style.layers.some((l: { id: string }) => l.id === 'road')).toBe(true);
    expect(style.layers[0]).toMatchObject({
      id: 'offline-background',
      type: 'background',
      paint: { 'background-color': '#101418' },
    });
  });

  it('returns null when there is no vector source or JSON is invalid', () => {
    const rasterOnly = JSON.stringify({
      version: 8,
      sources: {
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] },
      },
      layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }],
    });
    expect(buildOfflineStyle(rasterOnly, OPTS)).toBeNull();
    expect(buildOfflineStyle('not json', OPTS)).toBeNull();
  });
});
