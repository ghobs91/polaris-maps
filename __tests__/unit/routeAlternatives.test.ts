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
});
