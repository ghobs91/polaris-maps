jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../../src/contexts/ThemeContext';
import { useThemedStyles, type Theme } from '../../src/hooks/useThemedStyles';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { colors, darkColors } from '../../src/constants/theme';

const createStyles = ({ colors }: Theme) => ({ text: { color: colors.text } });

function Probe() {
  const styles = useThemedStyles(createStyles);
  const { isDark } = useTheme();
  return (
    <Text testID="probe" style={styles.text}>
      {isDark ? 'dark' : 'light'}
    </Text>
  );
}

describe('theme toggling updates representative surfaces', () => {
  it('recomputes themed styles when the mode changes', () => {
    act(() => useSettingsStore.setState({ themeMode: 'light' }));
    const { getByTestId, getByText } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(getByTestId('probe').props.style.color).toBe(colors.text);

    act(() => useSettingsStore.setState({ themeMode: 'dark' }));

    expect(getByText('dark')).toBeTruthy();
    expect(getByTestId('probe').props.style.color).toBe(darkColors.text);
  });
});
