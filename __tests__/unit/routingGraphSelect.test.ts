/**
 * Unit tests for pure offline-routing graph selection.
 */

import {
  boundsArea,
  boundsContainPoint,
  entryCoverage,
  isGlobishBounds,
  selectRoutingGraph,
  selectRoutingGraphTargets,
  unionBounds,
  type RoutingGraphCandidate,
} from '../../src/utils/routingGraphSelect';

const metro: RoutingGraphCandidate = {
  id: 'catalog:us-ny-new-york',
  dir: '/graph/metro',
  bounds: { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 },
};

const state: RoutingGraphCandidate = {
  id: 'region:north-america-us-new-york',
  dir: '/graph/state',
  bounds: { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.8 },
};

const nyc = { lat: 40.7128, lng: -74.006 };
const albany = { lat: 42.6526, lng: -73.7562 };

describe('boundsContainPoint', () => {
  it('contains a point inside the box and rejects one outside', () => {
    expect(boundsContainPoint(metro.bounds, nyc.lat, nyc.lng)).toBe(true);
    expect(boundsContainPoint(metro.bounds, albany.lat, albany.lng)).toBe(false);
  });
});

describe('boundsArea', () => {
  it('is larger for the state than the metro', () => {
    expect(boundsArea(state.bounds)).toBeGreaterThan(boundsArea(metro.bounds));
  });
});

describe('selectRoutingGraph', () => {
  it('returns null when no candidate covers any point', () => {
    expect(selectRoutingGraph([metro], [albany])).toBeNull();
  });

  it('prefers the graph covering the most points', () => {
    // Only the state covers both points.
    expect(selectRoutingGraph([metro, state], [nyc, albany])?.id).toBe(state.id);
  });

  it('breaks ties toward the smaller (more specific) graph', () => {
    expect(selectRoutingGraph([state, metro], [nyc])?.id).toBe(metro.id);
  });

  it('still selects a graph that covers only the origin', () => {
    const boston = { lat: 42.3601, lng: -71.0589 }; // outside both graphs
    expect(selectRoutingGraph([state, metro], [nyc, boston])?.id).toBe(metro.id);
  });
});

describe('unionBounds', () => {
  it('widens the narrow box so eastern Queens stays inside the metro', () => {
    // The compiled-in catalog ends at -73.7; the published catalog at -73.2.
    const compiled = { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.7 };
    const published = { minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 };
    const bounds = unionBounds(compiled, published);

    expect(bounds).toEqual({ minLat: 40.4, maxLat: 41.0, minLng: -74.3, maxLng: -73.2 });
    // The point that used to fall outside every installed graph.
    expect(boundsContainPoint(bounds, 40.7415, -73.673)).toBe(true);
    expect(boundsContainPoint(compiled, 40.7415, -73.673)).toBe(false);
  });
});

describe('isGlobishBounds', () => {
  it('rejects a pack that spans the date line', () => {
    // Kiribati, verbatim from geofabrikCatalog.ts.
    expect(isGlobishBounds({ minLat: -11.5, maxLat: 3.9, minLng: -175.0, maxLng: 177.0 })).toBe(
      true,
    );
  });

  it('accepts an ordinary metro or state pack', () => {
    expect(metro.bounds).toBeDefined();
    expect(isGlobishBounds(metro.bounds)).toBe(false);
    expect(isGlobishBounds(state.bounds)).toBe(false);
  });
});

describe('entryCoverage', () => {
  it('is 1 when the metro sits well inside the pack', () => {
    const stateInner = { minLat: 40.0, maxLat: 45.0, minLng: -79.8, maxLng: -71.8 };
    expect(entryCoverage(metro.bounds, stateInner)).toBe(1);
  });

  it('is less than 1 when the pack clips the metro edge', () => {
    // `state` starts at lat 40.5, so it misses the metro's 40.4 edge.
    expect(entryCoverage(metro.bounds, state.bounds)).toBeCloseTo(5 / 6, 5);
  });

  it('is 0 when the boxes only share an edge', () => {
    const above = { minLat: 41.0, maxLat: 42.0, minLng: -74.3, maxLng: -73.7 };
    expect(entryCoverage(metro.bounds, above)).toBe(0);
  });

  it('is fractional for a partial overlap', () => {
    const half = { minLat: 40.4, maxLat: 40.7, minLng: -74.3, maxLng: -73.7 };
    expect(entryCoverage(metro.bounds, half)).toBeCloseTo(0.5, 5);
  });
});

describe('selectRoutingGraphTargets', () => {
  const nyMetro = { id: 'us-ny-new-york', bounds: metro.bounds };
  const jakarta = {
    id: 'id-jakarta',
    bounds: { minLat: -6.8, maxLat: -6.0, minLng: 106.6, maxLng: 107.1 },
  };
  const nairobi = {
    id: 'ke-nairobi',
    bounds: { minLat: -1.5, maxLat: -1.1, minLng: 36.6, maxLng: 37.1 },
  };
  const singapore = {
    id: 'sg-singapore',
    bounds: { minLat: 1.2, maxLat: 1.5, minLng: 103.6, maxLng: 104.1 },
  };

  it('downloads nothing for a pack whose box spans the date line', () => {
    // Regression: the Kiribati pack installed 241 MB of graphs for metros it
    // holds no data for, because every one of them fell inside its bbox.
    const kiribati = { minLat: -11.5, maxLat: 3.9, minLng: -175.0, maxLng: 177.0 };
    expect(selectRoutingGraphTargets([jakarta, nairobi, singapore], kiribati)).toEqual([]);
  });

  it('picks the metro graph for a metro pack', () => {
    const ids = selectRoutingGraphTargets([nyMetro, jakarta], metro.bounds).map((e) => e.id);
    expect(ids).toEqual(['us-ny-new-york']);
  });

  it('picks the metro graph for a wider state pack that contains it', () => {
    const ids = selectRoutingGraphTargets([nyMetro, jakarta], state.bounds, {
      packId: 'north-america-us-new-york',
    }).map((e) => e.id);
    expect(ids).toEqual(['us-ny-new-york']);
  });

  it('does not claim a metro from a foreign country that its rectangle encloses', () => {
    // Toronto sits inside the New York *state* pack's rectangle — it is across
    // Lake Ontario, in Canada — and was previously ranked first because its box
    // was 100% covered. Its id names nothing in the pack id, so it is dropped.
    const toronto = {
      id: 'ca-on-toronto',
      bounds: { minLat: 43.58, maxLat: 43.86, minLng: -79.64, maxLng: -79.15 },
    };
    const ids = selectRoutingGraphTargets([nyMetro, toronto], state.bounds, {
      packId: 'north-america-us-new-york',
    }).map((e) => e.id);

    expect(ids).toEqual(['us-ny-new-york']);
  });

  it('keeps geometry-only matching when the pack id is unknown', () => {
    const ids = selectRoutingGraphTargets([nyMetro], state.bounds).map((e) => e.id);
    expect(ids).toEqual(['us-ny-new-york']);
  });

  it('ranks by coverage so the cap is spent on the pack’s own metros', () => {
    const tiny = {
      id: 'tiny',
      bounds: { minLat: 40.5, maxLat: 40.55, minLng: -74.3, maxLng: -74.25 },
    };
    const ids = selectRoutingGraphTargets([nyMetro, tiny, jakarta], state.bounds, {
      maxTargets: 2,
    }).map((e) => e.id);
    // `tiny` is wholly covered (1.0) and outranks the metro clipped by the
    // state's northern edge (0.83); the cap of 2 drops Jakarta entirely.
    expect(ids).toEqual(['tiny', 'us-ny-new-york']);
  });

  it('drops a metro the pack only clips', () => {
    const sliver = { minLat: 40.4, maxLat: 40.45, minLng: -74.3, maxLng: -73.7 };
    expect(selectRoutingGraphTargets([nyMetro], sliver)).toEqual([]);
  });
});
