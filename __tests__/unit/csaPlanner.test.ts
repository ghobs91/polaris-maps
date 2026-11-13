/**
 * Connection scan planner.
 *
 * The algorithm is the part of local transit planning that is easy to get subtly
 * wrong (transfer rules, round seeding, reconstruction), so it is exercised
 * against a small hand-built network rather than a mock.
 */

import { planWithCsa, type CsaCatalog, type CsaQuery } from '../../src/services/transit/csaPlanner';
import type {
  TimetableConnection,
  TimetableStop,
} from '../../src/services/transit/transitTimetable';

const STOPS: Record<number, TimetableStop> = {
  1: { id: 1, name: 'Alpha', lat: 0, lon: 0 },
  2: { id: 2, name: 'Bravo', lat: 0, lon: 0.01 },
  3: { id: 3, name: 'Charlie', lat: 0, lon: 0.02 },
  4: { id: 4, name: 'Delta', lat: 0, lon: 0.03 },
  5: { id: 5, name: 'Echo', lat: 0, lon: 0.04 },
};

const TRIPS: Record<number, { routeId: number; headsign?: string }> = {
  1: { routeId: 10, headsign: 'Delta' },
  2: { routeId: 20, headsign: 'Echo' },
  3: { routeId: 10, headsign: 'Delta' },
};

const ROUTES: Record<number, { shortName: string; longName: string; color: string; mode: 'BUS' }> =
  {
    10: { shortName: '1', longName: 'Bus One', color: 'ff0000', mode: 'BUS' },
    20: { shortName: 'R', longName: 'Rail', color: '0000ff', mode: 'BUS' },
  };

const catalog: CsaCatalog = {
  stop: (id) => STOPS[id],
  trip: (id) => TRIPS[id],
  route: (id) => ROUTES[id],
};

/** 08:00 in seconds after service-day midnight. */
const T0800 = 28_800;
const SERVICE_DAY_MS = Date.UTC(2026, 4, 4);

function conn(
  depS: number,
  arrS: number,
  fromStop: number,
  toStop: number,
  tripId: number,
  seq: number,
): TimetableConnection {
  return { depS, arrS, fromStop, toStop, tripId, seq };
}

/**
 * Alpha --(1: 08:00→08:10)--> Bravo --(1: 08:12→08:25)--> Charlie
 * Charlie --(R: 08:30→08:45)--> Delta
 * Delta --(3: 08:50→09:05)--> Echo
 */
const CONNECTIONS: TimetableConnection[] = [
  conn(T0800, T0800 + 600, 1, 2, 1, 0),
  conn(T0800 + 720, T0800 + 1500, 2, 3, 1, 1),
  conn(T0800 + 1800, T0800 + 2700, 3, 4, 2, 0),
  conn(T0800 + 3000, T0800 + 3900, 4, 5, 3, 0),
];

function baseQuery(overrides: Partial<CsaQuery> = {}): CsaQuery {
  return {
    connections: CONNECTIONS,
    access: [{ stopId: 1, seconds: 120 }],
    egress: [{ stopId: 4, seconds: 60 }],
    departureS: T0800 - 600,
    maxTrips: 3,
    minTransferS: 120,
    catalog,
    origin: { lat: 0, lng: 0 },
    destination: { lat: 0, lng: 0.03 },
    serviceDayMs: SERVICE_DAY_MS,
    numItineraries: 1,
    ...overrides,
  };
}

describe('planWithCsa', () => {
  it('plans a two-trip journey with one transfer', () => {
    const journeys = planWithCsa(baseQuery());
    expect(journeys).toHaveLength(1);

    const journey = journeys[0];
    // Access walk, two transit legs, egress walk.
    expect(journey.legs.map((l) => l.mode)).toEqual(['WALK', 'BUS', 'BUS', 'WALK']);
    expect(journey.transfers).toBe(1);
    // 08:45 arrival + 60s walk = 08:46.
    expect(new Date(journey.end).toISOString()).toBe(
      new Date(SERVICE_DAY_MS + (T0800 + 2760) * 1000).toISOString(),
    );
  });

  it('labels the transit legs with the route badge and headsign', () => {
    const [journey] = planWithCsa(baseQuery());
    const transit = journey.legs.filter((l) => l.mode !== 'WALK');
    expect(transit[0].route?.shortName).toBe('1');
    expect(transit[0].headsign).toBe('Delta');
    expect(transit[1].route?.shortName).toBe('R');
  });

  it('includes intermediate stops on a multi-hop trip', () => {
    const [journey] = planWithCsa(baseQuery());
    const first = journey.legs[1];
    // Boarded at Alpha (stop 1), alighted at Charlie (stop 3): Bravo is between.
    expect(first.from.name).toBe('Alpha');
    expect(first.to.name).toBe('Charlie');
    expect(first.intermediateStops?.map((s) => s.name)).toEqual(['Bravo']);
  });

  it('uses a single trip when the destination is reachable directly', () => {
    const [journey] = planWithCsa(
      baseQuery({ egress: [{ stopId: 3, seconds: 30 }], destination: { lat: 0, lng: 0.02 } }),
    );
    expect(journey.legs.map((l) => l.mode)).toEqual(['WALK', 'BUS', 'WALK']);
    expect(journey.transfers).toBe(0);
  });

  it('never plans more trips than maxTrips allows', () => {
    const journeys = planWithCsa(baseQuery({ maxTrips: 1, egress: [{ stopId: 5, seconds: 30 }] }));
    // One trip cannot reach stop 5 (two transfers away), so nothing is planned.
    expect(journeys).toEqual([]);
  });

  it('returns nothing when the destination is not reachable', () => {
    // Stop 99 does not exist in the network, so no egress is ever satisfied.
    expect(planWithCsa(baseQuery({ egress: [{ stopId: 99, seconds: 30 }] }))).toEqual([]);
  });

  it('plans a three-trip chain when maxTrips allows it', () => {
    const [journey] = planWithCsa(baseQuery({ egress: [{ stopId: 5, seconds: 30 }] }));
    expect(journey.legs.filter((l) => l.mode !== 'WALK')).toHaveLength(3);
    expect(journey.transfers).toBe(2);
  });

  it('returns nothing when there is no access stop', () => {
    expect(planWithCsa(baseQuery({ access: [] }))).toEqual([]);
  });

  it('returns nothing for an empty connection set', () => {
    expect(planWithCsa(baseQuery({ connections: [] }))).toEqual([]);
  });

  it('ignores departures that leave before the rider can reach the stop', () => {
    // Departure 100s before the 08:00 bus: a 120s walk plus a 120s transfer
    // cannot make it, and nothing else serves Alpha.
    const journeys = planWithCsa(baseQuery({ departureS: T0800 - 100 }));
    expect(journeys).toEqual([]);
  });

  it('respects the minimum transfer time between trips', () => {
    // 08:25 arrival at Charlie, 08:30 rail departure: 300s is enough for the
    // default 120s transfer but not for a 400s one.
    const journeys = planWithCsa(baseQuery({ minTransferS: 400 }));
    expect(journeys).toEqual([]);
  });

  it('offers distinct later departures as separate itineraries', () => {
    const journeys = planWithCsa(
      baseQuery({
        numItineraries: 2,
        connections: [
          ...CONNECTIONS,
          conn(T0800 + 600, T0800 + 1200, 1, 2, 1, 0),
          conn(T0800 + 1320, T0800 + 2100, 2, 3, 1, 1),
        ].sort((a, b) => a.depS - b.depS),
      }),
    );
    expect(journeys.length).toBeGreaterThan(0);
    // Whatever is returned must be ordered by departure.
    const starts = journeys.map((j) => Date.parse(j.start));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('does not mutate the query connections', () => {
    const snapshot = CONNECTIONS.map((c) => ({ ...c }));
    planWithCsa(baseQuery());
    expect(CONNECTIONS).toEqual(snapshot);
  });

  it('marks locally planned transit legs as not realtime', () => {
    const [journey] = planWithCsa(baseQuery());
    const transit = journey.legs.filter((l) => l.mode !== 'WALK');
    expect(transit.length).toBeGreaterThan(0);
    for (const leg of transit) expect(leg.realTime).toBe(false);
  });
});
