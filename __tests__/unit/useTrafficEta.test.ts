import { prefersRouteApiEta } from '../../src/hooks/useTrafficEta';

describe('prefersRouteApiEta', () => {
  it('asks the route API when too little of the route matched local traffic', () => {
    expect(prefersRouteApiEta(0, 'p2p')).toBe(true);
    expect(prefersRouteApiEta(0.09, 'local-fresh')).toBe(true);
  });

  it('trusts the local computation once enough of the route matched', () => {
    expect(prefersRouteApiEta(0.1, 'p2p')).toBe(false);
    expect(prefersRouteApiEta(0.8, 'tomtom')).toBe(false);
  });

  it('always asks the route API when the traffic on screen is aged fallback data', () => {
    // Aged segments match the route geometry, so the coverage threshold would
    // never fire on its own — the stale ETA has to lose to a fresh one.
    expect(prefersRouteApiEta(1, 'aged')).toBe(true);
    expect(prefersRouteApiEta(0.5, 'aged')).toBe(true);
  });

  it('falls back to the match-ratio rule when no source was recorded', () => {
    expect(prefersRouteApiEta(0.5, null)).toBe(false);
    expect(prefersRouteApiEta(0.05, null)).toBe(true);
  });
});
