import {
  compassVisible,
  computeScaleBar,
  normalizeHeading,
  NICE_SCALE_STEPS_M,
} from '../../src/utils/mapChrome';

describe('normalizeHeading', () => {
  it('wraps bearings into (-180, 180]', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(370)).toBe(10);
    expect(normalizeHeading(-10)).toBe(-10);
    expect(normalizeHeading(200)).toBe(-160);
    expect(normalizeHeading(540)).toBe(180);
    expect(normalizeHeading(360)).toBe(0);
  });
});

describe('compassVisible', () => {
  it('is hidden when north-up and flat', () => {
    expect(compassVisible(0, 0)).toBe(false);
    expect(compassVisible(360, 0)).toBe(false);
  });

  it('shows when rotated or tilted', () => {
    expect(compassVisible(15, 0)).toBe(true);
    expect(compassVisible(0, 20)).toBe(true);
    expect(compassVisible(-5, 0)).toBe(true);
  });

  it('ignores tiny rotations below the threshold', () => {
    expect(compassVisible(1, 0, 2)).toBe(false);
  });
});

describe('computeScaleBar', () => {
  it('picks a nice round distance within the pixel budget', () => {
    const bar = computeScaleBar(14, 40, 64);
    expect(NICE_SCALE_STEPS_M).toContain(bar.metres);
    expect(bar.widthPx).toBeLessThanOrEqual(64);
    expect(bar.widthPx).toBeGreaterThan(0);
  });

  it('represents a larger distance when zoomed out', () => {
    const near = computeScaleBar(16, 40);
    const far = computeScaleBar(8, 40);
    expect(far.metres).toBeGreaterThan(near.metres);
  });

  it('accounts for latitude (smaller metres at high latitude)', () => {
    const equator = computeScaleBar(12, 0);
    const highLat = computeScaleBar(12, 60);
    expect(highLat.metres).toBeLessThanOrEqual(equator.metres);
  });

  it('never exceeds the pixel budget', () => {
    for (const zoom of [3, 8, 12, 16, 19]) {
      expect(computeScaleBar(zoom, 45, 64).widthPx).toBeLessThanOrEqual(64);
    }
  });
});
