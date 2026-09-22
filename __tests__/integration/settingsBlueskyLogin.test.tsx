import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
  MaterialCommunityIcons: () => null,
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      primary: '#0A84FF',
      text: '#000000',
      textSecondary: '#666666',
      border: '#CCCCCC',
      surface: '#F2F2F7',
    },
  }),
}));

jest.mock('../../src/services/places/placeDetailCache', () => ({
  clearPlaceDetailCache: jest.fn().mockResolvedValue(undefined),
  countPlaceDetailCache: jest.fn().mockResolvedValue(0),
}));

const mockBskyLogin = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/stores/atprotoAuthStore', () => ({
  useAtprotoAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      session: null,
      error: null,
      isLoading: false,
      login: mockBskyLogin,
      logout: jest.fn(),
    }),
}));

jest.mock('../../src/stores/osmAuthStore', () => ({
  useOsmAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: null,
      accessToken: null,
      isLoggingIn: false,
      login: jest.fn(),
      logout: jest.fn(),
    }),
}));

jest.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({
      permissions: {},
      themeMode: 'system',
      useMetric: false,
      voiceGuidanceEnabled: false,
      routePreferences: { avoidTolls: false, avoidHighways: false, avoidFerries: false },
      setPermissions: jest.fn(),
      setRoutePreferences: jest.fn(),
      setThemeMode: jest.fn(),
      setUseMetric: jest.fn(),
      setVoiceGuidanceEnabled: jest.fn(),
    }),
}));

jest.mock('../../src/components/common', () => {
  const mockReact = jest.requireActual('react') as typeof React;
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    Button: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) =>
      mockReact.createElement(
        Pressable,
        { onPress, disabled, accessibilityLabel: title },
        mockReact.createElement(Text, null, title),
      ),
    SettingsGroup: ({ children }: { children: React.ReactNode }) =>
      mockReact.createElement(View, null, children),
    SettingsRow: () => null,
    SFSymbol: () => null,
    SegmentedControl: () => null,
  };
});

import { SettingsContent } from '../../src/components/settings/SettingsContent';

describe('SettingsContent Bluesky sign-in', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in with the handle the user enters, not a hardcoded domain', () => {
    const screen = render(<SettingsContent />);

    fireEvent.changeText(screen.getByLabelText('Bluesky handle'), 'alice.bsky.social');
    fireEvent.press(screen.getByLabelText('Sign in to leave reviews'));

    expect(mockBskyLogin).toHaveBeenCalledWith('alice.bsky.social');
    expect(mockBskyLogin).not.toHaveBeenCalledWith('bsky.social');
  });

  it('strips a leading @ from the entered handle', () => {
    const screen = render(<SettingsContent />);

    fireEvent.changeText(screen.getByLabelText('Bluesky handle'), '@alice.bsky.social');
    fireEvent.press(screen.getByLabelText('Sign in to leave reviews'));

    expect(mockBskyLogin).toHaveBeenCalledWith('alice.bsky.social');
  });
});
