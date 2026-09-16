import {
  isRerouteCoolingDown,
  isReplacementRouteAcceptable,
  REROUTE_COOLDOWN_MS,
  SIGNIFICANT_DELAY_FACTOR,
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

describe('isReplacementRouteAcceptable', () => {
  it('accepts a route that is faster than the current one', () => {
    expect(isReplacementRouteAcceptable(100, 200)).toBe(true);
  });

  it('accepts a route within the tolerance band', () => {
    // current * 1.25 = 250s; anything under that is accepted.
    expect(isReplacementRouteAcceptable(240, 200)).toBe(true);
  });

  it('rejects a route at or beyond the tolerance factor', () => {
    expect(isReplacementRouteAcceptable(250, 200)).toBe(false);
    expect(isReplacementRouteAcceptable(260, 200)).toBe(false);
  });

  it('uses the documented factor boundary', () => {
    const current = 200;
    expect(isReplacementRouteAcceptable(current * SIGNIFICANT_DELAY_FACTOR, current)).toBe(false);
    expect(isReplacementRouteAcceptable(current * SIGNIFICANT_DELAY_FACTOR - 1, current)).toBe(
      true,
    );
  });
});
