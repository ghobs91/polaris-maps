import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#000000', background: '#FFFFFF', primary: '#0A84FF' },
  }),
}));

jest.mock('../../src/utils/haptics', () => ({ hapticImpact: jest.fn() }));

import { ToastProvider, useToast } from '../../src/contexts/ToastContext';

function Consumer({ onAction }: { onAction: () => void }) {
  const { showToast } = useToast();
  return (
    <Pressable
      testID="show"
      onPress={() => showToast({ message: 'Parking spot cleared', actionLabel: 'Undo', onAction })}
    >
      <Text>show</Text>
    </Pressable>
  );
}

describe('ToastProvider', () => {
  it('shows a toast and dispatches the undo action on press', () => {
    const onAction = jest.fn();
    const screen = render(
      <ToastProvider>
        <Consumer onAction={onAction} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByTestId('show'));

    expect(screen.getByTestId('toast')).toBeTruthy();
    expect(screen.getByText('Parking spot cleared')).toBeTruthy();

    fireEvent.press(screen.getByTestId('toast-action'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('auto-dismisses after the duration', () => {
    jest.useFakeTimers();
    const screen = render(
      <ToastProvider>
        <Consumer onAction={() => {}} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByTestId('show'));
    expect(screen.getByTestId('toast')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.queryByTestId('toast')).toBeNull();
    jest.useRealTimers();
  });

  it('throws when useToast is used outside a provider', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer onAction={() => {}} />)).toThrow(/ToastProvider/);
    errorSpy.mockRestore();
  });
});
