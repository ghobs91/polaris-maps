import {
  coverageFromResolveSource,
  resolveTrafficCoverage,
  summarizeTrafficBreakdown,
} from '../../src/services/traffic/trafficCoverage';
import type { TrafficSourceBreakdown } from '../../src/models/trafficHistory';

function breakdown(overrides: Partial<TrafficSourceBreakdown> = {}): TrafficSourceBreakdown {
  return {
    requestedCells: 20,
    localProbe: 0,
    localSeeded: 0,
    p2p: 0,
    openFeed: 0,
    coldStart: 0,
    aged: 0,
    unresolved: 0,
    ...overrides,
  };
}

describe('coverageFromResolveSource', () => {
  it('maps each resolve source to a coverage status', () => {
    expect(coverageFromResolveSource('p2p')).toBe('p2p');
    expect(coverageFromResolveSource('open_feed')).toBe('open-feed');
    expect(coverageFromResolveSource('tomtom')).toBe('cold-start');
    expect(coverageFromResolveSource('local-fresh')).toBe('local');
    expect(coverageFromResolveSource('local-history')).toBe('local');
  });

  it('reports aged (last-known) data as stale, never as current', () => {
    expect(coverageFromResolveSource('aged')).toBe('stale');
    expect(resolveTrafficCoverage('aged', 10_000, 10_000)).toBe('stale');
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

describe('summarizeTrafficBreakdown', () => {
  it('always shows on-device, cold-start, peer, and open counts', () => {
    expect(summarizeTrafficBreakdown(breakdown({ localProbe: 12, coldStart: 5, p2p: 3 }))).toBe(
      'device 12 · tomtom 5 · peers 3 · open 0',
    );
  });

  it('calls out seeded local rows and unresolved cells when present', () => {
    expect(
      summarizeTrafficBreakdown(
        breakdown({ localProbe: 8, localSeeded: 4, coldStart: 5, unresolved: 3 }),
      ),
    ).toBe('device 8 · seeded 4 · tomtom 5 · peers 0 · open 0 · none 3');
  });

  it('shows an aged-fallback count when nothing live resolved', () => {
    expect(summarizeTrafficBreakdown(breakdown({ aged: 4 }))).toBe(
      'device 0 · tomtom 0 · peers 0 · open 0 · aged 4',
    );
  });

  it('returns an empty summary when no cells were requested', () => {
    expect(summarizeTrafficBreakdown(breakdown({ requestedCells: 0 }))).toBe('');
  });
});
