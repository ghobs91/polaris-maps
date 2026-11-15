import React from 'react';
import { act, render } from '@testing-library/react-native';

import { TrafficCoverageBadge } from '../../src/components/map/TrafficCoverageBadge';
import { useTrafficStore } from '../../src/stores/trafficStore';
import type { TrafficSourceBreakdown } from '../../src/models/trafficHistory';

const NOW = Math.floor(Date.now() / 1000);

function setCoverage(
  source: string | null,
  resolvedAt: number | null,
  breakdown: TrafficSourceBreakdown | null = null,
) {
  act(() => {
    useTrafficStore.setState({
      lastResolveSource: source,
      lastExternalFetchAt: resolvedAt,
      lastResolveBreakdown: breakdown,
    });
  });
}

function makeBreakdown(overrides: Partial<TrafficSourceBreakdown> = {}): TrafficSourceBreakdown {
  return {
    requestedCells: 20,
    localProbe: 0,
    localSeeded: 0,
    p2p: 0,
    openFeed: 0,
    coldStart: 0,
    unresolved: 0,
    ...overrides,
  };
}

describe('TrafficCoverageBadge', () => {
  afterEach(() => setCoverage(null, null));

  it.each([
    ['p2p', 'Peer network'],
    ['open_feed', 'Open data'],
    ['tomtom', 'Cold-start feed'],
    ['local-fresh', 'On-device history'],
  ])('labels the %s source as "%s"', (source, label) => {
    setCoverage(source, NOW);

    const screen = render(<TrafficCoverageBadge />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(`Traffic coverage: ${label}`)).toBeTruthy();
  });

  it('distinguishes no-data from a resolved source', () => {
    setCoverage(null, null);

    const screen = render(<TrafficCoverageBadge />);

    expect(screen.getByText('No traffic data')).toBeTruthy();
  });

  it('reports stale data when the source resolved outside the freshness window', () => {
    setCoverage('p2p', NOW - 60 * 60);

    const screen = render(<TrafficCoverageBadge />);

    expect(screen.getByText('Stale traffic data')).toBeTruthy();
  });

  it('breaks the resolution down so TomTom does not hide on-device history', () => {
    setCoverage(
      'tomtom',
      NOW,
      makeBreakdown({ localProbe: 12, p2p: 3, coldStart: 5, unresolved: 2 }),
    );

    const screen = render(<TrafficCoverageBadge />);

    expect(screen.getByText('Cold-start feed')).toBeTruthy();
    expect(screen.getByText('device 12 · tomtom 5 · peers 3 · open 0 · none 2')).toBeTruthy();
  });

  it('marks seeded local rows so on-device history stays honest', () => {
    setCoverage('local-fresh', NOW, makeBreakdown({ localProbe: 0, localSeeded: 4 }));

    const screen = render(<TrafficCoverageBadge />);

    expect(screen.getByText('On-device history (seeded)')).toBeTruthy();
    expect(screen.getByText('device 0 · seeded 4 · tomtom 0 · peers 0 · open 0')).toBeTruthy();
  });
});
