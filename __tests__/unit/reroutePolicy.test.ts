import {
  isRerouteCoolingDown,
  isSignificantlyFasterRoute,
  MIN_FASTER_ROUTE_SAVING_SECONDS,
  REROUTE_COOLDOWN_MS,
} from '../../src/services/traffic/reroutePolicy';

describe('isRerouteCoolingDown', () => {
  it('is false when no reroute has happened yet', () => {
    expect(isRerouteCoolingDown(Date.now(), 0)).toBe(false);
  });

  it('is true inside the cooldown window', () => {
    const now = 1_000_000;
    expect(isRerouteCoolingDown(now, now - REROUTE_COOLDOWN_MS + 1)).toBe(true);
  });

  it('is false once the cooldown has elapsed', () => {
    const now = 1_000_000;
    expect(isRerouteCoolingDown(now, now - REROUTE_COOLDOWN_MS)).toBe(false);
    expect(isRerouteCoolingDown(now, now - REROUTE_COOLDOWN_MS - 5_000)).toBe(false);
  });

  it('honours a custom cooldown', () => {
    const now = 1_000_000;
    expect(isRerouteCoolingDown(now, now - 1_000, 500)).toBe(false);
    expect(isRerouteCoolingDown(now, now - 1_000, 5_000)).toBe(true);
  });
});

describe('isSignificantlyFasterRoute', () => {
  it('accepts a candidate that saves at least the minimum', () => {
    expect(isSignificantlyFasterRoute(600, 800)).toBe(true);
    expect(isSignificantlyFasterRoute(800 - MIN_FASTER_ROUTE_SAVING_SECONDS, 800)).toBe(true);
  });

  it('rejects a candidate that saves less than the minimum', () => {
    expect(isSignificantlyFasterRoute(800 - MIN_FASTER_ROUTE_SAVING_SECONDS + 1, 800)).toBe(false);
  });

  it('rejects a candidate that is slower or equal', () => {
    expect(isSignificantlyFasterRoute(800, 800)).toBe(false);
    expect(isSignificantlyFasterRoute(900, 800)).toBe(false);
  });

  it('never treats a non-positive current duration as improvable', () => {
    expect(isSignificantlyFasterRoute(0, 0)).toBe(false);
    expect(isSignificantlyFasterRoute(10, -5)).toBe(false);
  });

  it('honours a custom minimum', () => {
    expect(isSignificantlyFasterRoute(700, 800, 60)).toBe(true);
    expect(isSignificantlyFasterRoute(750, 800, 60)).toBe(false);
  });
});
