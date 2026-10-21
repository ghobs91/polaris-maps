import { getMapOverlayInsets } from '../../src/utils/mapOverlayLayout';
import {
  LARGE_FLOATING_PANEL_MARGIN,
  LARGE_MAP_CONTENT_LEFT,
  largeFloatingPanelWidth,
  largeMapContentLeft,
} from '../../src/constants/layout';

describe('getMapOverlayInsets', () => {
  it('leaves phone layouts full width', () => {
    expect(getMapOverlayInsets(false)).toEqual({ left: 0, right: 0 });
  });

  it('clears the large-display panel on tablets and desktops', () => {
    expect(getMapOverlayInsets(true)).toEqual({
      left: LARGE_MAP_CONTENT_LEFT,
      right: LARGE_FLOATING_PANEL_MARGIN,
    });
  });

  it('starts overlays beyond the floating panel and its gap', () => {
    expect(LARGE_MAP_CONTENT_LEFT).toBeGreaterThan(LARGE_FLOATING_PANEL_MARGIN);
    expect(getMapOverlayInsets(true).left).toBeGreaterThan(0);
  });

  it('tracks the responsive panel width when the window is known', () => {
    expect(getMapOverlayInsets(true, 1600)).toEqual({
      left: largeMapContentLeft(1600),
      right: LARGE_FLOATING_PANEL_MARGIN,
    });
  });
});

describe('largeFloatingPanelWidth', () => {
  it('clamps to the minimum on narrow windows', () => {
    expect(largeFloatingPanelWidth(768)).toBe(360);
    expect(largeFloatingPanelWidth(320)).toBe(360);
  });

  it('scales with the window between the bounds', () => {
    expect(largeFloatingPanelWidth(1400)).toBe(420);
  });

  it('clamps to the maximum on very wide windows', () => {
    expect(largeFloatingPanelWidth(2560)).toBe(460);
  });
});
