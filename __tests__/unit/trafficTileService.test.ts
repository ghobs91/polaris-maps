import {
  tilesForViewport,
} from '../../src/services/traffic/trafficTileMath';

describe('tilesForViewport', () => {
  it('returns tiles around the map center at the rounded zoom', () => {
    // NYC-ish coordinates at zoom 10
    const tiles = tilesForViewport(40.7, -74.0, 10, 390, 844);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(35); // at most 5x7 tiles
    for (const t of tiles) {
      expect(t.z).toBe(10);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(Math.pow(2, 10));
      expect(t.y).toBeLessThan(Math.pow(2, 10));
    }
  });

  it('clamps zoom to the supported range', () => {
    expect(tilesForViewport(40.7, -74.0, 22, 390, 844)[0].z).toBe(14);
    expect(tilesForViewport(40.7, -74.0, 0, 390, 844)[0].z).toBe(4);
  });

  it('sorts tiles center-first', () => {
    const tiles = tilesForViewport(40.7, -74.0, 12, 390, 844);
    // First tile is the one containing the center coordinate
    const first = tiles[0];
    expect(first.z).toBe(12);
    // The center tile must be closest to the computed center — check that
    // its coordinates match the Web Mercator projection of the center.
    const n = Math.pow(2, 12);
    const cx = Math.floor((( -74.0 + 180) / 360) * n);
    const latRad = (40.7 * Math.PI) / 180;
    const cy = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    );
    expect(first.x).toBe(cx);
    expect(first.y).toBe(cy);
  });

  it('wraps tile ranges at the map edges', () => {
    // Near the international date line
    const tiles = tilesForViewport(0, 179.9, 8, 390, 844);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(Math.pow(2, 8));
    }
  });

  it('handles small screens with at least a few tiles', () => {
    const tiles = tilesForViewport(51.5, -0.12, 11, 100, 100);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
  });
});
