import {
  NAVIGATION_MODE_CAPABILITIES,
  navigationModeCapabilities,
  navigationModeForCosting,
} from '../../src/utils/navigationMode';

describe('navigationModeForCosting', () => {
  it('maps each costing model to a guidance mode', () => {
    expect(navigationModeForCosting('auto')).toBe('driving');
    expect(navigationModeForCosting('pedestrian')).toBe('walking');
    expect(navigationModeForCosting('bicycle')).toBe('cycling');
    expect(navigationModeForCosting('transit')).toBe('transit');
  });
});

describe('navigation mode capabilities', () => {
  it('shows automotive widgets only when driving', () => {
    expect(navigationModeCapabilities('driving')).toEqual({
      laneGuidance: true,
      speedLimit: true,
      speedometer: true,
    });
  });

  it('hides automotive widgets for pedestrian, bicycle, and transit', () => {
    for (const mode of ['walking', 'cycling', 'transit'] as const) {
      expect(navigationModeCapabilities(mode)).toEqual({
        laneGuidance: false,
        speedLimit: false,
        speedometer: false,
      });
    }
  });

  it('exposes capabilities for every mode', () => {
    for (const mode of ['driving', 'walking', 'cycling', 'transit'] as const) {
      expect(NAVIGATION_MODE_CAPABILITIES[mode]).toBeDefined();
    }
  });
});
