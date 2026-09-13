import { buildUpcomingStops, moveStop, removeStop } from '../../src/utils/navigationStops';
import type { ValhallaRoute } from '../../src/models/route';

function makeRoute(legDurations: number[]): ValhallaRoute {
  return {
    summary: {
      distanceMeters: 0,
      durationSeconds: legDurations.reduce((sum, seconds) => sum + seconds, 0),
      hasToll: false,
      hasFerry: false,
    },
    legs: legDurations.map((durationSeconds) => ({
      maneuvers: [],
      distanceMeters: 0,
      durationSeconds,
    })),
    geometry: '',
    boundingBox: [0, 0, 0, 0],
  };
}

describe('buildUpcomingStops', () => {
  it('returns only the destination when there are no waypoints', () => {
    const stops = buildUpcomingStops(makeRoute([600]), [], 0, { name: 'Home' });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      waypointIndex: -1,
      name: 'Home',
      isDestination: true,
      etaSeconds: 600,
    });
  });

  it('accumulates leg durations for each pending stop then the destination', () => {
    // legs: origin→A (300s), A→B (200s), B→destination (400s)
    const route = makeRoute([300, 200, 400]);
    const waypoints = [
      { lat: 1, lng: 1, name: 'A' },
      { lat: 2, lng: 2, name: 'B' },
    ];
    const stops = buildUpcomingStops(route, waypoints, 0, { name: 'Dest' });
    expect(stops.map((s) => [s.name, s.etaSeconds])).toEqual([
      ['A', 300],
      ['B', 500],
      ['Dest', 900],
    ]);
    expect(stops.map((s) => s.waypointIndex)).toEqual([0, 1, -1]);
    expect(stops[2].isDestination).toBe(true);
  });

  it('skips completed legs and labels unnamed stops', () => {
    const route = makeRoute([300, 200, 400]);
    const stops = buildUpcomingStops(
      route,
      [
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
      ],
      1,
      null,
    );
    expect(stops.map((s) => [s.name, s.etaSeconds])).toEqual([
      ['Stop 2', 200],
      ['Destination', 600],
    ]);
  });

  it('falls back to zero ETAs when the route is missing', () => {
    const stops = buildUpcomingStops(null, [{ lat: 1, lng: 1, name: 'A' }], 0, { name: 'D' });
    expect(stops.map((s) => s.etaSeconds)).toEqual([0, 0]);
  });

  it('clamps an out-of-range currentLegIndex', () => {
    const stops = buildUpcomingStops(
      makeRoute([100, 200]),
      [{ lat: 1, lng: 1, name: 'A' }],
      5,
      null,
    );
    expect(stops.map((s) => s.name)).toEqual(['Destination']);
  });
});

describe('removeStop', () => {
  it('removes the stop at the given index without mutating the input', () => {
    const stops = ['a', 'b', 'c'];
    expect(removeStop(stops, 1)).toEqual(['a', 'c']);
    expect(stops).toEqual(['a', 'b', 'c']);
  });

  it('ignores out-of-range indices', () => {
    expect(removeStop(['a'], 4)).toEqual(['a']);
  });
});

describe('moveStop', () => {
  it('swaps a stop with the one after it', () => {
    expect(moveStop(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps a stop with the one before it', () => {
    expect(moveStop(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('returns the same reference when the move would fall out of bounds', () => {
    const stops = ['a', 'b'];
    expect(moveStop(stops, 0, -1)).toBe(stops);
    expect(moveStop(stops, 1, 1)).toBe(stops);
    expect(moveStop(stops, 9, 1)).toBe(stops);
  });
});
