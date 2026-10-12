import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('../../src/services/traffic/rerouteService', () => ({
  noteFasterRouteDismissed: jest.fn(),
}));

import { FasterRouteBanner } from '../../src/components/navigation/FasterRouteBanner';
import { useNavigationStore } from '../../src/stores/navigationStore';
import { noteFasterRouteDismissed } from '../../src/services/traffic/rerouteService';
import type { ValhallaRoute } from '../../src/models/route';

function makeRoute(id: string, durationSeconds: number): ValhallaRoute {
  return {
    summary: { durationSeconds, distanceMeters: 8000, hasToll: false, hasHighway: false },
    geometry: `geom-${id}`,
    legs: [{ maneuvers: [{ type: 'start', instruction: `go ${id}` }] }],
    boundingBox: undefined,
  } as unknown as ValhallaRoute;
}

const primary = makeRoute('primary', 900);
const faster = makeRoute('faster', 600);
const destination = { lat: 40, lng: -74, name: 'Dest' };

beforeEach(() => {
  jest.clearAllMocks();
  useNavigationStore.getState().stopNavigation();
  useNavigationStore.getState().startNavigation(primary, [], destination, 'auto', []);
});

describe('FasterRouteBanner', () => {
  it('renders nothing when there is no suggestion', () => {
    const screen = render(<FasterRouteBanner />);
    expect(screen.queryByText(/Faster route/)).toBeNull();
  });

  it('shows the time saved', () => {
    useNavigationStore.getState().suggestFasterRoute(faster, 300);
    const screen = render(<FasterRouteBanner />);
    expect(screen.getByText(/Faster route/)).toBeTruthy();
    expect(screen.getByText(/5 min/)).toBeTruthy();
  });

  it('accepting adopts the route and clears the suggestion', () => {
    useNavigationStore.getState().suggestFasterRoute(faster, 300);
    const screen = render(<FasterRouteBanner />);

    fireEvent.press(screen.getByText('Take it'));

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(faster);
    expect(state.fasterRouteSuggestion).toBeNull();
  });

  it('dismissing keeps the route, clears the suggestion, and starts the cooldown', () => {
    useNavigationStore.getState().suggestFasterRoute(faster, 300);
    const screen = render(<FasterRouteBanner />);

    fireEvent.press(screen.getByLabelText('Dismiss faster route suggestion'));

    const state = useNavigationStore.getState();
    expect(state.activeRoute).toBe(primary);
    expect(state.fasterRouteSuggestion).toBeNull();
    expect(noteFasterRouteDismissed).toHaveBeenCalledTimes(1);
  });
});
