import {
  distanceToRouteMeters,
  selectStopsAlongRoute,
  ROUTE_CORRIDOR_FALLBACK_LIMIT,
} from '../../src/utils/routeCorridor';

/** Straight eastbound route along the 40th parallel, ~8.5 km long. */
const route: Array<[number, number]> = [
  [-74, 40],
  [-73.99, 40],
  [-73.98, 40],
  [-73.97, 40],
  [-73.96, 40],
];

describe('distanceToRouteMeters', () => {
  it('returns ~0 for a point on the polyline', () => {
    expect(distanceToRouteMeters(40, -73.985, route)).toBeLessThan(1);
  });

  it('measures the perpendicular offset for an off-route point', () => {
    // 0.01° of latitude is roughly 1.1 km.
    const distance = distanceToRouteMeters(40.01, -73.985, route);
    expect(distance).toBeGreaterThan(1100);
    expect(distance).toBeLessThan(1120);
  });

  it('returns Infinity without a route', () => {
    expect(distanceToRouteMeters(40, -73.98, [])).toBe(Infinity);
  });
});

describe('selectStopsAlongRoute', () => {
  const results = [
    { id: 'on-route', lat: 40, lng: -73.985 },
    { id: 'far-north', lat: 40.05, lng: -73.985 },
    { id: 'near-route', lat: 40.002, lng: -73.98 },
  ];

  it('keeps picks within the corridor and preserves order', () => {
    const selected = selectStopsAlongRoute(results, route);
    expect(selected.map((result) => result.id)).toEqual(['on-route', 'near-route']);
  });

  it('prefers options ahead of the driver over ones just behind', () => {
    const origin = { lat: 40, lng: -73.97 };
    const behind = { id: 'behind', lat: 40.0004, lng: -73.98 };
    const ahead = { id: 'ahead', lat: 40.0004, lng: -73.965 };

    // Both sit the same distance off the road, but only one is still ahead.
    expect(distanceToRouteMeters(behind.lat, behind.lng, route)).toBeLessThan(50);
    expect(distanceToRouteMeters(ahead.lat, ahead.lng, route)).toBeLessThan(50);

    const selected = selectStopsAlongRoute([behind, ahead], route, origin, 200);
    expect(selected.map((result) => result.id)).toEqual(['ahead']);
  });

  it('falls back to the nearest few when the corridor is empty', () => {
    const far = [
      { id: 'a', lat: 40.2, lng: -73.985 },
      { id: 'b', lat: 40.4, lng: -73.985 },
      { id: 'c', lat: 40.3, lng: -73.985 },
      { id: 'd', lat: 40.6, lng: -73.985 },
    ];
    const selected = selectStopsAlongRoute(far, route);
    expect(selected).toHaveLength(ROUTE_CORRIDOR_FALLBACK_LIMIT);
    expect(selected.map((result) => result.id)).toEqual(['a', 'c', 'b']);
  });

  it('returns the results untouched when there is no route yet', () => {
    expect(selectStopsAlongRoute(results, [])).toBe(results);
  });
});
