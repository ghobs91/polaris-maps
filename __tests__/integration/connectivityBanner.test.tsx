import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}));

// Render the icon as a plain host component so the icon set's async font load
// doesn't emit an act() warning.
jest.mock('@expo/vector-icons', () => {
  const mockReact = jest.requireActual('react') as typeof React;
  return {
    Ionicons: (props: Record<string, unknown>) => mockReact.createElement('Ionicons', props),
  };
});

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      warning: '#FF9500',
      white: '#FFFFFF',
      background: '#FFFFFF',
      border: '#CCCCCC',
      surface: '#F2F2F7',
      text: '#000000',
      textSecondary: '#666666',
      primary: '#0A84FF',
    },
  }),
}));

jest.mock('@/services/sync/offlineQueue', () => ({
  getQueueSize: jest.fn(() => 7),
}));

import { usePeerStore } from '@/stores/peerStore';
import { ConnectivityBanner } from '@/components/common/ConnectivityBanner';

describe('ConnectivityBanner', () => {
  beforeEach(() => {
    act(() => usePeerStore.setState({ isOnline: true }));
  });

  it('stays hidden while online', () => {
    const screen = render(<ConnectivityBanner />);
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });

  it('shows the queue count, dismisses, and re-arms after reconnect', async () => {
    act(() => usePeerStore.setState({ isOnline: false }));
    const screen = render(<ConnectivityBanner />);
    await waitFor(() => expect(screen.getByText(/7 actions queued/)).toBeTruthy());

    fireEvent.press(screen.getByTestId('connectivity-banner-dismiss'));
    expect(screen.queryByText(/You're offline/)).toBeNull();

    // Reconnect, then drop again — the banner must return.
    act(() => usePeerStore.setState({ isOnline: true }));
    await waitFor(() => expect(screen.queryByText(/You're offline/)).toBeNull());
    act(() => usePeerStore.setState({ isOnline: false }));
    await waitFor(() => expect(screen.getByText(/You're offline/)).toBeTruthy());
  });
});
