import React from 'react';
import { act, render } from '@testing-library/react-native';

import { TrafficCoverageBadge } from '../../src/components/map/TrafficCoverageBadge';
import { useTrafficStore } from '../../src/stores/trafficStore';

const NOW = Math.floor(Date.now() / 1000);

function setCoverage(source: string | null, resolvedAt: number | null) {
  act(() => {
    useTrafficStore.setState({ lastResolveSource: source, lastExternalFetchAt: resolvedAt });
  });
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
});
