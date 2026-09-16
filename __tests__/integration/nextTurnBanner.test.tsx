import React from 'react';
import { render } from '@testing-library/react-native';
import { NextTurnBanner } from '../../src/components/navigation/NextTurnBanner';
import type { ValhallaManeuver } from '../../src/models/route';

const exitManeuver: ValhallaManeuver = {
  type: 'exit_highway',
  instruction: 'Take the exit on the right toward New York',
  distanceMeters: 800,
  durationSeconds: 30,
  beginShapeIndex: 0,
  endShapeIndex: 1,
  verbalPreTransition: 'Take exit 91B on the right toward New York',
};

describe('NextTurnBanner', () => {
  it('makes the exact exit number and name prominent', () => {
    const screen = render(
      <NextTurnBanner
        maneuver={{
          ...exitManeuver,
          exitNumber: '91B',
          exitBranch: 'I 95 North',
          exitToward: 'New York',
        }}
      />,
    );

    expect(screen.getByText('EXIT')).toBeTruthy();
    expect(screen.getByText('91B')).toBeTruthy();
    expect(screen.getByText('I 95 North')).toBeTruthy();
    expect(screen.getByText('toward New York')).toBeTruthy();
  });

  it('prefers the interchange name over the branch road', () => {
    const screen = render(
      <NextTurnBanner
        maneuver={{ ...exitManeuver, exitNumber: '12A', exitName: 'Gettysburg Pike' }}
      />,
    );

    expect(screen.getByText('12A')).toBeTruthy();
    expect(screen.getByText('Gettysburg Pike')).toBeTruthy();
  });

  it('renders no exit UI for a plain turn', () => {
    const screen = render(
      <NextTurnBanner
        maneuver={{
          ...exitManeuver,
          type: 'turn_left',
          verbalPreTransition: 'Turn left onto Main Street',
        }}
      />,
    );

    expect(screen.queryByText('EXIT')).toBeNull();
    expect(
      screen.getByText('Turn left onto Main Street', { includeHiddenElements: true }),
    ).toBeTruthy();
  });
});
