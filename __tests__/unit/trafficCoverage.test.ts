import {
  coverageFromResolveSource,
  resolveTrafficCoverage,
} from '../../src/services/traffic/trafficCoverage';

describe('coverageFromResolveSource', () => {
  it('maps each resolve source to a coverage status', () => {
    expect(coverageFromResolveSource('p2p')).toBe('p2p');
    expect(coverageFromResolveSource('open_feed')).toBe('open-feed');
    expect(coverageFromResolveSource('tomtom')).toBe('cold-start');
    expect(coverageFromResolveSource('local-fresh')).toBe('local');
    expect(coverageFromResolveSource('local-history')).toBe('local');
  });

  it('treats unknown/empty sources as no-data', () => {
    expect(coverageFromResolveSource(null)).toBe('no-data');
    expect(coverageFromResolveSource(undefined)).toBe('no-data');
    expect(coverageFromResolveSource('none')).toBe('no-data');
  });
});

describe('resolveTrafficCoverage', () => {
  it('reports stale when the resolution is older than the window', () => {
    const now = 10_000;
    expect(resolveTrafficCoverage('p2p', now - 3_600, now)).toBe('stale');
  });

  it('reports fresh coverage within the window', () => {
    const now = 10_000;
    expect(resolveTrafficCoverage('open_feed', now - 60, now)).toBe('open-feed');
  });

  it('never reports stale for no-data', () => {
    expect(resolveTrafficCoverage('none', 0, 10_000)).toBe('no-data');
  });
});
