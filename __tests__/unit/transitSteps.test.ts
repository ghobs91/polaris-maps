import { buildTransitSteps } from '../../src/services/transit/transitSteps';
import type { OtpItinerary, OtpLeg } from '../../src/models/transit';

function leg(partial: Partial<OtpLeg> & { mode: OtpLeg['mode'] }): OtpLeg {
  return {
    from: { name: 'A', lat: 0, lon: 0 },
    to: { name: 'B', lat: 0, lon: 0 },
    startTime: 0,
    endTime: 300,
    duration: 300,
    distance: 400,
    legGeometry: { points: '' },
    ...partial,
  } as OtpLeg;
}

function itinerary(legs: OtpLeg[]): OtpItinerary {
  return { start: '', end: '', duration: 0, walkDistance: 0, waitingTime: 0, transfers: 0, legs };
}

describe('buildTransitSteps', () => {
  it('returns nothing for a missing itinerary', () => {
    expect(buildTransitSteps(null)).toEqual([]);
    expect(buildTransitSteps(undefined)).toEqual([]);
  });

  it('produces ordered walk and transit steps', () => {
    const steps = buildTransitSteps(
      itinerary([
        leg({ mode: 'WALK', to: { name: 'Main St', lat: 0, lon: 0 } }),
        leg({
          mode: 'BUS',
          from: { name: 'Main St', lat: 0, lon: 0 },
          to: { name: 'Elm St', lat: 0, lon: 0 },
          headsign: 'Downtown',
          route: { gtfsId: 'r1', shortName: '12', mode: 'BUS' },
          intermediateStops: [{ name: '1st', lat: 0, lon: 0 }],
        }),
      ]),
    );

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ kind: 'walk', title: 'Walk to Main St' });
    expect(steps[1].kind).toBe('transit');
    expect(steps[1].title).toBe('12 to Downtown');
    expect(steps[1].routeRef).toBe('12');
    expect(steps[1].detail).toContain('Board at Main St');
    expect(steps[1].detail).toContain('2 stops');
  });

  it('labels bicycle legs distinctly', () => {
    const [step] = buildTransitSteps(itinerary([leg({ mode: 'BICYCLE' })]));
    expect(step.kind).toBe('bike');
    expect(step.title).toBe('Bike to B');
  });

  it('falls back to the leg mode when there is no route ref', () => {
    const [step] = buildTransitSteps(itinerary([leg({ mode: 'FERRY', headsign: 'Island' })]));
    expect(step.title).toBe('FERRY to Island');
  });
});
