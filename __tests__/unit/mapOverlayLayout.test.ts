import { getMapOverlayInsets } from '../../src/utils/mapOverlayLayout';
import { LARGE_FLOATING_PANEL_MARGIN, LARGE_MAP_CONTENT_LEFT } from '../../src/constants/layout';

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
});
