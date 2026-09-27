import React from 'react';
import { render } from '@testing-library/react-native';

// `units.ts` reads the unit preference from the settings store, which reaches
// for encrypted storage on import.
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

import { SpeedCluster } from '../../src/components/navigation/SpeedCluster';
import { CurrentRoadPill } from '../../src/components/navigation/CurrentRoadPill';
import { useSettingsStore } from '../../src/stores/settingsStore';

/** Flatten RN's style prop, which may be an array. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style as Record<string, unknown>) ?? {};
}

function colourOf(node: { props: { style?: unknown } }): unknown {
  return flatten(node.props.style).color;
}

describe('SpeedCluster', () => {
  beforeEach(() => {
    useSettingsStore.setState({ useMetric: false });
  });

  it('shows the posted limit and the current speed side by side', () => {
    const screen = render(<SpeedCluster speedLimitMph={55} speedMph={72} over />);

    expect(screen.getByText('55')).toBeTruthy();
    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.getByText('mph')).toBeTruthy();
  });

  it('turns the current speed red only once the driver is over the limit', () => {
    const over = render(<SpeedCluster speedLimitMph={55} speedMph={72} over />);
    const under = render(<SpeedCluster speedLimitMph={55} speedMph={48} over={false} />);

    const overColour = colourOf(over.getByText('72'));
    const underColour = colourOf(under.getByText('48'));

    expect(overColour).toBeTruthy();
    expect(underColour).toBeTruthy();
    // The signal is the colour change, not a specific hex — the token can move.
    expect(overColour).not.toBe(underColour);
    // The posted limit never changes colour; it is not the alarm.
    expect(colourOf(over.getByText('55'))).toBe(colourOf(under.getByText('55')));
  });

  it('converts to km/h when the user prefers metric', () => {
    useSettingsStore.setState({ useMetric: true });
    const screen = render(<SpeedCluster speedLimitMph={55} speedMph={72} over />);

    // 55 mph → 89 km/h, 72 mph → 116 km/h.
    expect(screen.getByText('89')).toBeTruthy();
    expect(screen.getByText('116')).toBeTruthy();
    expect(screen.getByText('km/h')).toBeTruthy();
  });

  it('drops the limit cell when the road has no limit data', () => {
    const screen = render(<SpeedCluster speedLimitMph={null} speedMph={72} over={false} />);

    expect(screen.queryByText('mph')).toBeTruthy();
    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.queryByText('55')).toBeNull();
  });

  it('drops the speed cell when there is no fix yet', () => {
    const screen = render(<SpeedCluster speedLimitMph={55} speedMph={null} over={false} />);

    expect(screen.getByText('55')).toBeTruthy();
    expect(screen.queryByText('mph')).toBeNull();
  });

  it('ignores a stationary or nonsensical speed', () => {
    // Parked: showing "0 mph" next to a limit reads as a fault.
    expect(
      render(<SpeedCluster speedLimitMph={55} speedMph={0} over={false} />).queryByText('0'),
    ).toBeNull();
    expect(
      render(<SpeedCluster speedLimitMph={55} speedMph={NaN} over={false} />).queryByText('NaN'),
    ).toBeNull();
  });

  it('renders nothing at all when it has neither number', () => {
    const screen = render(<SpeedCluster speedLimitMph={null} speedMph={null} over={false} />);

    expect(screen.toJSON()).toBeNull();
  });

  it('announces both readings, and the over-limit state, to a screen reader', () => {
    const over = render(<SpeedCluster speedLimitMph={55} speedMph={72} over />);
    expect(over.getByLabelText(/speed limit 55 mph/i)).toBeTruthy();
    expect(over.getByLabelText(/over the speed limit/i)).toBeTruthy();

    const under = render(<SpeedCluster speedLimitMph={55} speedMph={48} over={false} />);
    expect(under.queryByLabelText(/over the speed limit/i)).toBeNull();
  });
});

describe('CurrentRoadPill', () => {
  it('shows the road being travelled', () => {
    const screen = render(<CurrentRoadPill roadName="Wantagh State Pkwy" />);

    expect(screen.getByText('Wantagh State Pkwy')).toBeTruthy();
    expect(screen.getByLabelText('On Wantagh State Pkwy')).toBeTruthy();
  });

  it('renders nothing when the road is unnamed', () => {
    expect(render(<CurrentRoadPill roadName={null} />).toJSON()).toBeNull();
  });
});
