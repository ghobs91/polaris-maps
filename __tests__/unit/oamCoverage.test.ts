/**
 * Tests for OpenAerialMap viewport coverage (STAC lookup + overlay source).
 */

import {
  findOamCoverage,
  intersectBBox,
  oamOverlaySource,
} from '../../src/services/map/oamCoverage';
import type { BBox } from '../../src/services/map/tileRouter';

function jsonFetch(body: unknown, ok = true): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return { ok, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

function featureCollection(bboxes: unknown[]): unknown {
  return { type: 'FeatureCollection', features: bboxes.map((bbox) => ({ bbox })) };
}

describe('intersectBBox', () => {
  it('returns the overlap of two intersecting boxes', () => {
    expect(intersectBBox([0, 0, 10, 10], [5, 5, 15, 15])).toEqual([5, 5, 10, 10]);
  });

  it('returns null when the boxes are disjoint', () => {
    expect(intersectBBox([0, 0, 1, 1], [2, 2, 3, 3])).toBeNull();
  });
});

describe('findOamCoverage', () => {
  it('unions the intersecting footprint bboxes, clipped to the viewport', async () => {
    const { fetchImpl } = jsonFetch(
      featureCollection([
        [2, 2, 4, 4],
        [6, 6, 12, 12],
      ]),
    );
    const coverage = await findOamCoverage([0, 0, 10, 10], { fetchImpl });
    expect(coverage).toEqual([2, 2, 10, 10]);
  });

  it('returns null when there are no features', async () => {
    const { fetchImpl } = jsonFetch(featureCollection([]));
    expect(await findOamCoverage([100, 10, 101, 11], { fetchImpl })).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const { fetchImpl } = jsonFetch({}, false);
    expect(await findOamCoverage([110, 10, 111, 11], { fetchImpl })).toBeNull();
  });

  it('ignores malformed footprint bboxes', async () => {
    const { fetchImpl } = jsonFetch(
      featureCollection([null, 'nope', [1, 2, 3], [1, 2, 3, 'x'], [30, 30, 31, 31]]),
    );
    expect(await findOamCoverage([29, 29, 32, 32], { fetchImpl })).toEqual([30, 30, 31, 31]);
  });

  it('caches successful lookups for the same viewport', async () => {
    const { fetchImpl, calls } = jsonFetch(featureCollection([[40, 40, 41, 41]]));
    const first = await findOamCoverage([39, 39, 42, 42], { fetchImpl });
    const second = await findOamCoverage([39, 39, 42, 42], { fetchImpl });
    expect(first).toEqual([40, 40, 41, 41]);
    expect(second).toEqual(first);
    expect(calls()).toBe(1);
  });
});

describe('oamOverlaySource', () => {
  it('wraps the OAM registry entry with the coverage bounds', () => {
    const coverage: BBox = [12, 41, 13, 42];
    const source = oamOverlaySource(coverage);
    expect(source.id).toBe('oam');
    expect(source.bounds).toEqual(coverage);
    expect(source.tiles[0]).toContain('openaerialmap');
    expect(source.attribution).toContain('OpenAerialMap');
  });
});
