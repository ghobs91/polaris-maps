import { prefersRouteApiEta } from '../../src/hooks/useTrafficEta';

describe('prefersRouteApiEta', () => {
  it('asks the route API when too little of the route matched local traffic', () => {
    expect(prefersRouteApiEta(0)).toBe(true);
    expect(prefersRouteApiEta(0.09)).toBe(true);
  });

  it('trusts the local computation once enough of the route matched', () => {
    expect(prefersRouteApiEta(0.1)).toBe(false);
    expect(prefersRouteApiEta(0.8)).toBe(false);
  });

  it('does not ask the route API for well-matched saved data, however it was sourced', () => {
    // Saved data — the weekly profile, holiday rows, or last-known aged
    // segments — is road-level granular data the device already has. Per the
    // provider-usage rule it wins over a fresh API call once it covers the
    // route; a full match from the aged tier must not trigger a request.
    expect(prefersRouteApiEta(1)).toBe(false);
    expect(prefersRouteApiEta(0.5)).toBe(false);
  });
});
