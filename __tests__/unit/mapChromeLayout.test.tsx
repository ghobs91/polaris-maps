import React from 'react';
import { render } from '@testing-library/react-native';
import { MapChrome } from '../../src/components/map/MapChrome';
import { LARGE_MAP_CONTENT_LEFT } from '../../src/constants/layout';

/** Flatten RN's style prop, which may be an array. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style as Record<string, unknown>) ?? {};
}

function props() {
  return {
    bearing: 0,
    pitch: 0,
    zoom: 14,
    lat: 40,
    onReset: jest.fn(),
  };
}

describe('MapChrome layout', () => {
  it('hugs the screen edge by default', () => {
    const screen = render(<MapChrome {...props()} />);
    expect(flatten(screen.getByTestId('map-chrome').props.style).left).toBe(12);
  });

  it('clears the large-display panel when the host supplies a left inset', () => {
    const screen = render(<MapChrome {...props()} leftInset={LARGE_MAP_CONTENT_LEFT} />);
    expect(flatten(screen.getByTestId('map-chrome').props.style).left).toBe(LARGE_MAP_CONTENT_LEFT);
  });
});
