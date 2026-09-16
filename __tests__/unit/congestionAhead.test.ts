import {
  evaluateCongestionAhead,
  type TrafficObservation,
} from '../../src/services/traffic/congestionAhead';

// A straight ~3.3 km route heading east at the equator. 0.01° lng ≈ 1113 m.
const ROUTE: [number, number][] = [
  [0, 0],
  [0.01, 0],
  [0.02, 0],
  [0.03, 0],
];

function congested(lng: number, ratio = 0.5): TrafficObservation {
  return { position: [lng, 0], congestionRatio: ratio };
}

describe('evaluateCongestionAhead', () => {
  it('reports nothing when there are no observations', () => {
    const result = evaluateCongestionAhead(ROUTE, [0, 0], []);
    expect(result.hasSignificantCongestion).toBe(false);
    expect(result.congestedCount).toBe(0);
  });

  it('flags significant congestion when enough congested observations lie ahead', () => {
    const result = evaluateCongestionAhead(
      ROUTE,
      [0, 0],
      [
        congested(0.01),
        congested(0.015),
        congested(0.02),
        { position: [0.025, 0], congestionRatio: 0.9 },
      ],
    );
    expect(result.congestedCount).toBe(3);
    expect(result.hasSignificantCongestion).toBe(true);
  });

  it('ignores congested observations behind the current position', () => {
    const result = evaluateCongestionAhead(
      ROUTE,
      [0.02, 0],
      [congested(0.005), congested(0.01), congested(0.015)],
    );
    expect(result.congestedCount).toBe(0);
    expect(result.hasSignificantCongestion).toBe(false);
  });

  it('ignores congested observations beyond the look-ahead window', () => {
    const result = evaluateCongestionAhead(ROUTE, [0, 0], [congested(0.03)], {
      lookaheadMeters: 1_000,
      minCongestedObservations: 1,
    });
    expect(result.congestedCount).toBe(0);
    expect(result.hasSignificantCongestion).toBe(false);
  });

  it('ignores observations at or above the congestion threshold', () => {
    const result = evaluateCongestionAhead(
      ROUTE,
      [0, 0],
      [
        { position: [0.01, 0], congestionRatio: 0.8 },
        { position: [0.02, 0], congestionRatio: 0.95 },
      ],
    );
    expect(result.congestedCount).toBe(0);
  });

  it('honours custom thresholds', () => {
    const result = evaluateCongestionAhead(ROUTE, [0, 0], [congested(0.02, 0.6)], {
      congestionRatioThreshold: 0.65,
      minCongestedObservations: 1,
    });
    expect(result.congestedCount).toBe(1);
    expect(result.hasSignificantCongestion).toBe(true);
  });

  it('returns no congestion for a route with fewer than two vertices', () => {
    const result = evaluateCongestionAhead([[0, 0]], [0, 0], [congested(0.01)]);
    expect(result.hasSignificantCongestion).toBe(false);
  });
});
