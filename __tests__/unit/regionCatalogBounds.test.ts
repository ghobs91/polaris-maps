/**
 * Unit tests for catalog bounding-box coverage helpers used to map a downloaded
 * region to the pre-built routing graphs that intersect it.
 */

import {
  boundsIntersect,
  catalogEntriesIntersectingBounds,
} from '../../src/constants/regionCatalog';

const nyState = { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.8 };
const midPacific = { minLat: -10, maxLat: 10, minLng: -160, maxLng: -140 };

describe('boundsIntersect', () => {
  it('detects overlapping boxes', () => {
    const nycMetro = { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 };
    expect(boundsIntersect(nyState, nycMetro)).toBe(true);
  });

  it('rejects disjoint boxes', () => {
    const nycMetro = { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 };
    expect(boundsIntersect(midPacific, nycMetro)).toBe(false);
  });
});

describe('catalogEntriesIntersectingBounds', () => {
  it('finds the New York metro graph for a New York state download', () => {
    const ids = catalogEntriesIntersectingBounds(nyState).map((entry) => entry.id);
    expect(ids).toContain('us-ny-new-york');
  });

  it('returns nothing for a region with no catalog coverage', () => {
    expect(catalogEntriesIntersectingBounds(midPacific)).toHaveLength(0);
  });
});
