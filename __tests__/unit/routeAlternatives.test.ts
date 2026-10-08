import { buildRouteAlternatives } from '../../src/services/routing/routeAlternatives';
import type { ValhallaRoute } from '../../src/models/route';

function makeRoute(durationSeconds: number, distanceMeters: number): ValhallaRoute {
  return {
    summary: { durationSeconds, distanceMeters, hasToll: false, hasHighway: false },
    geometry: '',
    legs: [],
    boundingBox: undefined,
  } as unknown as ValhallaRoute;
}

describe('buildRouteAlternatives', () => {
  it('returns nothing when there is no route', () => {
    expect(buildRouteAlternatives(null, [])).toEqual([]);
    expect(buildRouteAlternatives(undefined, [])).toEqual([]);
  });

  it('includes the primary and alternates, sorted fastest first', () => {
    const primary = makeRoute(600, 8000);
    const slow = makeRoute(720, 8600);
    const fast = makeRoute(540, 9000);

    const options = buildRouteAlternatives(primary, [slow, fast]);

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.durationSeconds)).toEqual([540, 600, 720]);
    expect(options[0].route).toBe(fast);
  });

  it('computes delay relative to the fastest route', () => {
    const primary = makeRoute(600, 8000);
    const alt = makeRoute(720, 8600);

    const options = buildRouteAlternatives(primary, [alt]);
    const primaryOption = options.find((o) => o.route === primary)!;
    const altOption = options.find((o) => o.route === alt)!;

    expect(primaryOption.delaySeconds).toBe(0);
    expect(altOption.delaySeconds).toBe(120);
  });

  it('preserves distance alongside duration', () => {
    const primary = makeRoute(600, 8000);
    const [option] = buildRouteAlternatives(primary, []);
    expect(option.distanceMeters).toBe(8000);
    expect(option.delaySeconds).toBe(0);
  });

  it('scales every option by the traffic factor so rows match the header', () => {
    const primary = makeRoute(600, 8000);
    const alt = makeRoute(720, 8600);

    // Header shows 1680 s (live) for a 600 s free-flow route → ×2.8.
    const options = buildRouteAlternatives(primary, [alt], 1680 / 600);

    expect(options.map((o) => o.durationSeconds)).toEqual([1680, 2016]);
    const altOption = options.find((o) => o.route === alt)!;
    // Delay stays proportional: 120 s free-flow → 336 s live.
    expect(altOption.delaySeconds).toBe(336);
  });

  it('ignores a non-positive traffic scale', () => {
    const options = buildRouteAlternatives(makeRoute(600, 8000), [], 0);
    expect(options[0].durationSeconds).toBe(600);
  });
});
