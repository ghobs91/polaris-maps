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
    savedFlow: 0,
    coldStart: 0,
    unresolved: 0,
    providerRequests: 0,
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

  it('reports saved upstream flow as saved, not stale and not cold-start', () => {
    expect(coverageFromResolveSource('saved-flow')).toBe('saved');
    // A saved bucket answer is current by definition: the bucket is the answer.
    expect(resolveTrafficCoverage('saved-flow', 10_000, 10_000)).toBe('saved');
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
      'device 12 · tomtom 5 · peers 3 · open 0 · requests 0',
    );
  });

  it('calls out seeded local rows and unresolved cells when present', () => {
    expect(
      summarizeTrafficBreakdown(
        breakdown({ localProbe: 8, localSeeded: 4, coldStart: 5, unresolved: 3 }),
      ),
    ).toBe('device 8 · seeded 4 · tomtom 5 · peers 0 · open 0 · none 3 · requests 0');
  });

  it('shows the saved-flow count and the provider requests it did not cost', () => {
    expect(summarizeTrafficBreakdown(breakdown({ savedFlow: 4 }))).toBe(
      'device 0 · tomtom 0 · peers 0 · open 0 · saved 4 · requests 0',
    );
  });

  it('returns an empty summary when no cells were requested', () => {
    expect(summarizeTrafficBreakdown(breakdown({ requestedCells: 0 }))).toBe('');
  });
});
