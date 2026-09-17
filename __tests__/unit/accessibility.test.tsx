jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: jest.fn(),
    getNumber: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { ThemeProvider } from '../../src/contexts/ThemeContext';
import { SegmentedControl } from '../../src/components/common/SegmentedControl';
import { useReducedMotion } from '../../src/hooks/useReducedMotion';

const OPTIONS = [
  { label: 'System', value: 'system' },
  { label: 'Dark', value: 'dark' },
];

describe('SegmentedControl accessibility', () => {
  it('exposes a radio role with selected state', () => {
    const { getByLabelText } = render(
      <ThemeProvider>
        <SegmentedControl options={OPTIONS} value="dark" onChange={() => {}} label="Theme" />
      </ThemeProvider>,
    );

    const dark = getByLabelText('Dark');
    expect(dark.props.accessibilityRole).toBe('radio');
    expect(dark.props.accessibilityState.selected).toBe(true);

    const system = getByLabelText('System');
    expect(system.props.accessibilityState.selected).toBe(false);
  });

  it('calls onChange when a segment is pressed', () => {
    const onChange = jest.fn();
    const { getByLabelText } = render(
      <ThemeProvider>
        <SegmentedControl options={OPTIONS} value="dark" onChange={onChange} label="Theme" />
      </ThemeProvider>,
    );

    fireEvent.press(getByLabelText('System'));
    expect(onChange).toHaveBeenCalledWith('system');
  });
});

describe('useReducedMotion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reflects the OS reduce-motion preference', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it('defaults to false when the pref is unavailable', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { result } = renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(false);
  });
});
