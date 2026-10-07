import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../src/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#000000', primary: '#0A84FF' },
  }),
}));

jest.mock('../../src/components/common', () => {
  const mockReact = jest.requireActual('react') as typeof React;
  return {
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? mockReact.createElement('View', null, children) : null,
  };
});

import { SortSheet } from '../../src/components/places/SortSheet';

const OPTIONS = [
  { key: 'recent', label: 'Most recently added' },
  { key: 'name', label: 'Name (A–Z)' },
] as const;

describe('SortSheet', () => {
  it('renders each option and calls onSelect then onClose', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const screen = render(
      <SortSheet
        visible
        options={[...OPTIONS]}
        value="recent"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Most recently added')).toBeTruthy();
    expect(screen.getByText('Name (A–Z)')).toBeTruthy();

    fireEvent.press(screen.getByTestId('sort-option-name'));
    expect(onSelect).toHaveBeenCalledWith('name');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const screen = render(
      <SortSheet
        visible={false}
        options={[...OPTIONS]}
        value="recent"
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByText('Most recently added')).toBeNull();
  });
});
