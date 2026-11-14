/**
 * Realtime overlay.
 *
 * A wrong match applies someone else's delay to your journey, so the matching
 * rules and the propagation bounds are the parts worth pinning down.
 */

import {
  MAX_PROPAGATED_DELAY_S,
  applyRealtimeToItineraries,
  applyRealtimeToItinerary,
  firstTransitLegIndex,
  matchLiveDeparture,
  toLiveDepartures,
  type LiveDeparture,
} from '../../src/services/transit/transitRealtimeOverlay';
import type { OtpItinerary, OtpLeg } from '../../src/models/transit';

const T0 = Date.UTC(2026, 4, 4, 8, 0, 0);

function walkLeg(startMs: number, durationS: number): OtpLeg {
  return {
    mode: 'WALK',
    from: { name: 'Origin', lat: 0, lon: 0 },
    to: { name: 'Stop A', lat: 0, lon: 0.01 },
    startTime: startMs,
    endTime: startMs + durationS * 1000,
    duration: durationS,
    distance: 200,
    legGeometry: { points: '' },
  };
}

function transitLeg(startMs: number, durationS: number, shortName = '1'): OtpLeg {
  return {
    mode: 'BUS',
    from: {
      name: 'Stop A',
      lat: 0,
      lon: 0.01,
      stop: { gtfsId: '1', name: 'Stop A' },
      departure: { scheduledTime: new Date(startMs).toISOString() },
    },
    to: {
      name: 'Stop B',
      lat: 0,
      lon: 0.02,
      stop: { gtfsId: '2', name: 'Stop B' },
      arrival: { scheduledTime: new Date(startMs + durationS * 1000).toISOString() },
    },
    startTime: startMs,
    endTime: startMs + durationS * 1000,
    duration: durationS,
    distance: 900,
    route: { gtfsId: 'r', shortName, longName: 'Bus One', mode: 'BUS' },
    legGeometry: { points: '' },
    realTime: false,
  };
}

function itinerary(): OtpItinerary {
  const legs = [walkLeg(T0, 300), transitLeg(T0 + 300_000, 600), walkLeg(T0 + 900_000, 120)];
  return {
    start: new Date(legs[0].startTime).toISOString(),
    end: new Date(legs[2].endTime).toISOString(),
    duration: 1_020,
    walkDistance: 400,
    waitingTime: 0,
    transfers: 0,
    legs,
  };
}

function live(overrides: Partial<LiveDeparture> = {}): LiveDeparture {
  return {
    routeName: '1',
    scheduledMs: T0 + 300_000,
    realtimeMs: T0 + 300_000,
    ...overrides,
  };
}

describe('firstTransitLegIndex', () => {
  it('skips leading walk legs', () => {
    expect(firstTransitLegIndex(itinerary())).toBe(1);
  });

  it('returns -1 for a walk-only journey', () => {
    expect(firstTransitLegIndex({ ...itinerary(), legs: [walkLeg(T0, 60)] })).toBe(-1);
  });
});

describe('matchLiveDeparture', () => {
  it('prefers an exact trip id', () => {
    const leg = { ...transitLeg(T0 + 300_000, 600), tripId: 'trip-9' };
    const match = matchLiveDeparture(leg, [
      live({ tripId: 'other', realtimeMs: T0 + 300_000 + 60_000 }),
      live({ tripId: 'trip-9', realtimeMs: T0 + 300_000 + 120_000 }),
    ]);
    expect(match?.realtimeMs).toBe(T0 + 300_000 + 120_000);
  });

  it('falls back to route badge plus scheduled proximity', () => {
    const match = matchLiveDeparture(transitLeg(T0 + 300_000, 600), [
      live({ routeName: '2', realtimeMs: T0 + 999_000 }),
      live({ realtimeMs: T0 + 300_000 + 90_000 }),
    ]);
    expect(match?.realtimeMs).toBe(T0 + 300_000 + 90_000);
  });

  it('rejects a departure scheduled outside the tolerance', () => {
    // Matching is on the *scheduled* time: a delayed bus still matches its own
    // schedule, but a different service 400s away must not.
    expect(
      matchLiveDeparture(transitLeg(T0 + 300_000, 600), [
        live({ scheduledMs: T0 + 700_000, realtimeMs: T0 + 700_000 }),
      ]),
    ).toBeNull();
  });

  it('matches a delayed departure to its own scheduled slot', () => {
    const match = matchLiveDeparture(transitLeg(T0 + 300_000, 600), [
      live({ realtimeMs: T0 + 300_000 + 240_000 }),
    ]);
    expect(match?.scheduledMs).toBe(T0 + 300_000);
  });

  it('ignores walk legs', () => {
    expect(matchLiveDeparture(walkLeg(T0, 60), [live()])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchLiveDeparture(transitLeg(T0 + 300_000, 600), [])).toBeNull();
  });
});

describe('applyRealtimeToItinerary', () => {
  it('leaves the plan untouched without a live delay', () => {
    const plan = itinerary();
    expect(applyRealtimeToItinerary(plan, [])).toBe(plan);
    expect(applyRealtimeToItinerary(plan, [live()])).toBe(plan);
  });

  it('shifts the boarding leg and everything after it', () => {
    const plan = itinerary();
    const delayed = applyRealtimeToItinerary(plan, [live({ realtimeMs: T0 + 300_000 + 120_000 })]);

    const boarding = delayed.legs[1];
    expect(boarding.startTime).toBe(plan.legs[1].startTime + 120_000);
    expect(boarding.endTime).toBe(plan.legs[1].endTime + 120_000);
    // Egress walk moves too.
    expect(delayed.legs[2].startTime).toBe(plan.legs[2].startTime + 120_000);
    // The access walk does not.
    expect(delayed.legs[0].startTime).toBe(plan.legs[0].startTime);
  });

  it('marks only the boarding leg as realtime', () => {
    const delayed = applyRealtimeToItinerary(itinerary(), [
      live({ realtimeMs: T0 + 300_000 + 60_000 }),
    ]);
    expect(delayed.legs[1].realTime).toBe(true);
    expect(delayed.legs[0].realTime).toBeUndefined();
  });

  it('does not mutate the input itinerary', () => {
    const plan = itinerary();
    const before = JSON.parse(JSON.stringify(plan));
    applyRealtimeToItinerary(plan, [live({ realtimeMs: T0 + 300_000 + 60_000 })]);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(before);
  });

  it('rejects a delay beyond the propagation bound', () => {
    const plan = itinerary();
    const huge = applyRealtimeToItinerary(plan, [
      live({ realtimeMs: T0 + 300_000 + (MAX_PROPAGATED_DELAY_S + 60) * 1000 }),
    ]);
    expect(huge).toBe(plan);
  });

  it('never boards before the rider can arrive at the stop', () => {
    const plan = itinerary();
    // An early departure cannot move the bus before the access walk finishes.
    const early = applyRealtimeToItinerary(plan, [live({ realtimeMs: T0 + 300_000 - 600_000 })]);
    expect(early.legs[1].startTime).toBeGreaterThanOrEqual(plan.legs[0].endTime);
  });

  it('records the delay on the boarding stop', () => {
    const delayed = applyRealtimeToItinerary(itinerary(), [
      live({ realtimeMs: T0 + 300_000 + 180_000 }),
    ]);
    expect(delayed.legs[1].from.departure?.estimated?.delay).toBe(180);
  });

  it('returns a walk-only journey unchanged', () => {
    const walkOnly: OtpItinerary = { ...itinerary(), legs: [walkLeg(T0, 60)] };
    expect(applyRealtimeToItinerary(walkOnly, [live()])).toBe(walkOnly);
  });
});

describe('applyRealtimeToItineraries', () => {
  it('returns a copy when there is no live data', () => {
    const plans = [itinerary()];
    const result = applyRealtimeToItineraries(plans, []);
    expect(result).toEqual(plans);
    expect(result).not.toBe(plans);
  });

  it('applies to every itinerary', () => {
    const result = applyRealtimeToItineraries(
      [itinerary(), itinerary()],
      [live({ realtimeMs: T0 + 300_000 + 60_000 })],
    );
    for (const plan of result) expect(plan.legs[1].realTime).toBe(true);
  });
});

describe('toLiveDepartures', () => {
  it('parses ISO times into epoch ms', () => {
    const [converted] = toLiveDepartures([
      {
        routeName: '1',
        scheduledTime: new Date(T0).toISOString(),
        realtimeTime: new Date(T0 + 60_000).toISOString(),
        tripId: 't1',
      },
    ]);
    expect(converted.scheduledMs).toBe(T0);
    expect(converted.realtimeMs).toBe(T0 + 60_000);
    expect(converted.tripId).toBe('t1');
  });

  it('leaves realtime undefined when the source has none', () => {
    const [converted] = toLiveDepartures([
      { routeName: '1', scheduledTime: new Date(T0).toISOString() },
    ]);
    expect(converted.realtimeMs).toBeUndefined();
  });

  it('drops rows with an unparseable scheduled time', () => {
    expect(toLiveDepartures([{ routeName: '1', scheduledTime: 'not-a-date' }])).toEqual([]);
  });
});
