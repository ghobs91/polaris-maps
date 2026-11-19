import {
  HORIZON_POLICIES,
  HORIZON_STRONG_MATCH,
  decideSearchHorizon,
  horizonFetchRadiusDeg,
  horizonFitBounds,
  isWithinHorizon,
} from '../../src/services/search/searchHorizon';

const anchor = { lat: 40.75, lng: -73.59 };

/** A candidate `km` north of the anchor. */
function at(km: number, id = km) {
  return { id, lat: anchor.lat + km / 111.32, lng: anchor.lng };
}

/** Every candidate is a full match — the pill / category-query case. */
const allStrong = () => 1;

describe('decideSearchHorizon', () => {
  it('answers a dense query in the tightest ring that holds the target', () => {
    // 30 strong matches inside 3 km: "coffee" in a suburb.
    const candidates = Array.from({ length: 30 }, (_, i) => at(0.2 + i * 0.09, i));

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES.nearby,
      strength: allStrong,
    });

    expect(decision.saturated).toBe(false);
    expect(decision.radiusKm).toBe(4);
    expect(decision.strongMatches).toBe(30);
  });

  it('widens to the last ring when the query has only a handful of matches', () => {
    // Three branches across the metro: "whole foods".
    const candidates = [at(3), at(15), at(32)];

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES['named-place'],
      strength: allStrong,
    });

    expect(decision.saturated).toBe(true);
    expect(decision.radiusKm).toBe(40);
    expect(decision.strongMatches).toBe(3);
  });

  it('snaps the radius upward to a ladder ring', () => {
    // Nine matches, the eighth at 9 km — the radius must not sit between rings.
    const candidates = Array.from({ length: 9 }, (_, i) => at(1 + i, i));

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES.nearby,
      strength: allStrong,
    });

    expect(decision.rawRadiusKm).toBeCloseTo(9, 0);
    expect(decision.radiusKm).toBe(12);
  });

  it('never frames tighter than the policy minimum', () => {
    const decision = decideSearchHorizon({
      candidates: [at(0.3), at(0.4), at(0.5)],
      anchor,
      policy: HORIZON_POLICIES.nearby,
      strength: allStrong,
    });

    expect(decision.radiusKm).toBe(HORIZON_POLICIES.nearby.minRadiusKm);
  });

  it('reaches a match beyond the widest ring instead of hiding it', () => {
    // A lone branch 120 km out is still the answer; a radius that stopped at
    // the ladder's last ring would have trimmed the only match away.
    const decision = decideSearchHorizon({
      candidates: [at(120)],
      anchor,
      policy: HORIZON_POLICIES['named-place'],
      strength: allStrong,
    });

    expect(decision.saturated).toBe(true);
    expect(decision.radiusKm).toBeCloseTo(120, 0);
    expect(decision.strongMatches).toBe(1);
  });

  it('ignores weak candidates when counting matches', () => {
    // One strong branch and 40 weak near-misses: the answer is the branch, so
    // the radius grows to reach it instead of collapsing onto the noise.
    const candidates = [
      at(20, 'strong'),
      ...Array.from({ length: 40 }, (_, i) => at(0.1 + i * 0.01, `weak-${i}`)),
    ];

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES['named-place'],
      strength: (c) => (c.id === 'strong' ? 1 : HORIZON_STRONG_MATCH - 0.1),
    });

    expect(decision.strongMatches).toBe(1);
    expect(decision.radiusKm).toBe(25);
  });

  it('reports no horizon when nothing matches', () => {
    const decision = decideSearchHorizon({
      candidates: [at(1), at(2)],
      anchor,
      policy: HORIZON_POLICIES.nearby,
      strength: () => 0,
    });

    expect(decision.radiusKm).toBe(0);
    expect(decision.strongMatches).toBe(0);
  });

  it('counts all candidates inside the chosen radius, not just strong ones', () => {
    const candidates = [at(1, 'a'), at(2, 'b'), at(30, 'c')];

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES.nearby,
      strength: (c) => (c.id === 'a' ? 1 : 0),
    });

    expect(decision.radiusKm).toBe(HORIZON_POLICIES.nearby.minRadiusKm);
    expect(decision.candidateCount).toBe(2);
  });

  it('accepts wrapped candidates through anchorOf', () => {
    const candidates = [
      { name: 'near', point: at(1) },
      { name: 'far', point: at(30) },
    ];

    const decision = decideSearchHorizon({
      candidates,
      anchor,
      policy: HORIZON_POLICIES['named-place'],
      strength: allStrong,
      anchorOf: (c) => c.point,
    });

    expect(decision.radiusKm).toBe(40);
    expect(decision.strongMatches).toBe(2);
  });
});

describe('horizonFitBounds', () => {
  it('frames the horizon circle around the anchor', () => {
    const bounds = horizonFitBounds(anchor, 16);

    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeLessThan(anchor.lat);
    expect(bounds!.maxLat).toBeGreaterThan(anchor.lat);
    expect(bounds!.minLng).toBeLessThan(anchor.lng);
    expect(bounds!.maxLng).toBeGreaterThan(anchor.lng);
    // Padded slightly beyond the radius so edge pins are not flush to the border.
    const halfSpanKm = (bounds!.maxLat - anchor.lat) * 111.32;
    expect(halfSpanKm).toBeGreaterThan(16);
    expect(halfSpanKm).toBeLessThan(20);
  });

  it('returns null for a non-positive radius', () => {
    expect(horizonFitBounds(anchor, 0)).toBeNull();
    expect(horizonFitBounds(anchor, -5)).toBeNull();
  });
});

describe('horizonFetchRadiusDeg', () => {
  it('spans the widest ring so one fetch populates every ring', () => {
    expect(horizonFetchRadiusDeg(HORIZON_POLICIES.nearby)).toBeCloseTo(30 / 111.32, 5);
    expect(horizonFetchRadiusDeg(HORIZON_POLICIES['named-place'])).toBeCloseTo(40 / 111.32, 5);
  });
});

describe('isWithinHorizon', () => {
  it('is false without a horizon', () => {
    expect(isWithinHorizon(at(1), anchor, 0)).toBe(false);
  });

  it('bounds inclusion by the radius', () => {
    expect(isWithinHorizon(at(5), anchor, 8)).toBe(true);
    expect(isWithinHorizon(at(9), anchor, 8)).toBe(false);
  });
});
