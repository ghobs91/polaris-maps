import { publishResolvedSegments } from '../../src/services/traffic/trafficFlowService';
import { useTrafficStore } from '../../src/stores/trafficStore';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

function makeSegment(
  id: string,
  coordinates: [number, number],
  overrides: Partial<NormalizedTrafficSegment> = {},
): NormalizedTrafficSegment {
  return {
    id,
    coordinates: [coordinates],
    currentSpeedMph: 30,
    freeFlowSpeedMph: 60,
    congestionRatio: 0.5,
    confidence: 0.8,
    source: 'history',
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function publishedIds(): string[] {
  return useTrafficStore.getState().normalizedSegments.map((s) => s.id);
}

describe('publishResolvedSegments', () => {
  beforeEach(() => {
    useTrafficStore.getState().clearAll();
  });

  it('replaces the store with the resolved set and records the source', () => {
    publishResolvedSegments(
      [makeSegment('resolved:1', [-73.9, 40.7]), makeSegment('resolved:2', [-73.8, 40.8])],
      'local-fresh',
      [],
    );

    expect(publishedIds()).toEqual(['resolved:1', 'resolved:2']);
    expect(useTrafficStore.getState().lastResolveSource).toBe('local-fresh');
  });

  it('publishes observations older than the previous publish', () => {
    // Seed the store so lastExternalFetchAt is set to "now".
    publishResolvedSegments([makeSegment('previous', [-73.9, 40.7])], 'tomtom', []);

    const historical = makeSegment('historical', [-73.8, 40.8], {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    publishResolvedSegments([historical], 'local-history', []);

    // Historical averages are a legitimate cascade tier; using the previous
    // publish time as a cutoff silently discarded them.
    expect(publishedIds()).toEqual(['historical']);
    expect(useTrafficStore.getState().lastResolveSource).toBe('local-history');
  });

  it('clears a previous resolution when the new one has no data', () => {
    publishResolvedSegments([makeSegment('stale', [-73.9, 40.7])], 'tomtom', []);

    publishResolvedSegments([], 'none', []);

    // Keeping the old segments is how a bad estimate outlived the data that
    // produced it.
    expect(publishedIds()).toEqual([]);
    expect(useTrafficStore.getState().lastResolveSource).toBe('none');
  });

  it('includes peer segments alongside the resolved set', () => {
    publishResolvedSegments([makeSegment('resolved', [-73.9, 40.7])], 'p2p', [
      makeSegment('peer', [-73.5, 40.9], { source: 'p2p' }),
    ]);

    expect(publishedIds().sort()).toEqual(['peer', 'resolved']);
  });
});
