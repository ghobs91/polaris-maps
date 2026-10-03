/**
 * Unit tests for pure offline-routing graph selection.
 */

import {
  boundsArea,
  boundsContainPoint,
  selectRoutingGraph,
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
