import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationHud } from '../../src/components/navigation/NavigationHud';
import type { UpcomingStop } from '../../src/utils/navigationStops';

jest.mock('../../src/components/common/GlassView', () => ({
  GlassView: ({ children }: { children: React.ReactNode }) => children,
}));

const upcomingStops: UpcomingStop[] = [
  { waypointIndex: 0, name: 'Coffee Shop', isDestination: false, etaSeconds: 300 },
  { waypointIndex: 1, name: 'Gas Station', isDestination: false, etaSeconds: 600 },
  { waypointIndex: -1, name: 'Grandma', isDestination: true, etaSeconds: 1200 },
];

function renderHud(overrides: Partial<React.ComponentProps<typeof NavigationHud>> = {}) {
  const props = {
    etaSeconds: 1200,
    remainingDistanceMeters: 8000,
    destinationName: 'Grandma',
    nextStopName: 'Coffee Shop',
    upcomingStops,
    onExit: jest.fn(),
    onAddStop: jest.fn(),
    onSkipStop: jest.fn(),
    onRemoveStop: jest.fn(),
    onMoveStop: jest.fn(),
    ...overrides,
  };
  const screen = render(<NavigationHud {...props} />);
  const expand = () => fireEvent(screen.getByLabelText('Expand stops'), 'accessibilityTap');
  return { screen, props, expand };
}

describe('NavigationHud', () => {
  it('shows the ETA bar and next stop while collapsed', () => {
    const { screen } = renderHud();
    expect(screen.getByLabelText(/ETA 20 min/)).toBeTruthy();
    expect(screen.getByText('Next: Coffee Shop')).toBeTruthy();
    expect(screen.getByText('Exit')).toBeTruthy();
  });

  it('skips the next stop from the collapsed banner', () => {
    const { screen, props } = renderHud();
    fireEvent.press(screen.getByLabelText('Skip stop'));
    expect(props.onSkipStop).toHaveBeenCalledTimes(1);
  });

  it('reveals every stop and the destination when expanded', () => {
    const { screen, expand } = renderHud();
    expand();
    expect(screen.getByText('Coffee Shop')).toBeTruthy();
    expect(screen.getByText('Gas Station')).toBeTruthy();
    expect(screen.getByText('Grandma')).toBeTruthy();
    expect(screen.getByText(/Destination/)).toBeTruthy();
  });

  it('removes a stop through the remove button', () => {
    const { screen, props, expand } = renderHud();
    expand();
    fireEvent.press(screen.getByLabelText('Remove Coffee Shop'));
    expect(props.onRemoveStop).toHaveBeenCalledWith(0);
  });

  it('reorders stops with the up/down buttons', () => {
    const { screen, props, expand } = renderHud();
    expand();
    fireEvent.press(screen.getByLabelText('Move Gas Station earlier'));
    expect(props.onMoveStop).toHaveBeenCalledWith(1, -1);
    fireEvent.press(screen.getByLabelText('Move Coffee Shop later'));
    expect(props.onMoveStop).toHaveBeenCalledWith(0, 1);
  });

  it('disables moving the first stop earlier and the last stop later', () => {
    const { screen, expand } = renderHud();
    expand();
    expect(screen.getByLabelText('Move Coffee Shop earlier').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(screen.getByLabelText('Move Gas Station later').props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('offers no editing controls on the final destination', () => {
    const { screen, expand } = renderHud();
    expand();
    expect(screen.queryByLabelText('Remove Grandma')).toBeNull();
    expect(screen.queryByLabelText('Move Grandma earlier')).toBeNull();
  });

  it('opens the add-stop flow when Add Stop is pressed', () => {
    const { screen, props, expand } = renderHud();
    expand();
    fireEvent.press(screen.getByLabelText('Add another stop'));
    expect(props.onAddStop).toHaveBeenCalledTimes(1);
  });
});
