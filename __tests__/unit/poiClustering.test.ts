import {
  clusterPoisForDisplay,
  gridDegreesForPixels,
  metersPerPixel,
} from '../../src/utils/poiClustering';
import type { OsmPoi } from '../../src/services/poi/osmFetcher';

function poi(id: number, lat: number, lng: number, subtype = 'cafe'): OsmPoi {
  return { id, lat, lng, name: `P${id}`, type: 'amenity', subtype, tags: {} };
}

describe('metersPerPixel / gridDegreesForPixels', () => {
  it('shrinks with zoom and grows with latitude', () => {
    expect(metersPerPixel(10, 0)).toBeGreaterThan(metersPerPixel(15, 0));
    expect(metersPerPixel(12, 60)).toBeLessThan(metersPerPixel(12, 0));
  });

  it('converts a pixel size into a degree grid', () => {
    const grid = gridDegreesForPixels(14, 40, 44);
    expect(grid).toBeGreaterThan(0);
    expect(gridDegreesForPixels(10, 40, 44)).toBeGreaterThan(grid);
  });
});

describe('clusterPoisForDisplay', () => {
  it('returns nothing for empty input', () => {
    expect(clusterPoisForDisplay([], 0.01)).toEqual([]);
    expect(clusterPoisForDisplay([poi(1, 0, 0)], 0)).toEqual([]);
  });

  it('groups nearby POIs and reports count and centroid', () => {
    const pois = [poi(1, 40.7, -74.0), poi(2, 40.7001, -74.0001), poi(3, 40.9, -74.5)];
    const clusters = clusterPoisForDisplay(pois, 0.01);

    expect(clusters).toHaveLength(2);
    const big = clusters.find((c) => c.count === 2)!;
    expect(big.poiIds.sort()).toEqual([1, 2]);
    expect(big.lat).toBeCloseTo(40.70005, 4);
  });

  it('uses a finer grid to split clusters', () => {
    const pois = [poi(1, 40.7, -74.0), poi(2, 40.7001, -74.0001)];
    expect(clusterPoisForDisplay(pois, 0.01)).toHaveLength(1);
    expect(clusterPoisForDisplay(pois, 0.00001)).toHaveLength(2);
  });

  it('picks the dominant subtype', () => {
    const pois = [
      poi(1, 40.7, -74.0, 'restaurant'),
      poi(2, 40.70005, -74.00005, 'restaurant'),
      poi(3, 40.7001, -74.0001, 'cafe'),
    ];
    const [cluster] = clusterPoisForDisplay(pois, 0.01);
    expect(cluster.dominantCategory).toBe('restaurant');
  });

  it('carries every member id', () => {
    const pois = [poi(1, 40.7, -74.0), poi(2, 40.70001, -74.00001), poi(3, 40.70002, -74.0)];
    const [cluster] = clusterPoisForDisplay(pois, 0.01);
    expect(cluster.poiIds).toHaveLength(3);
  });
});
