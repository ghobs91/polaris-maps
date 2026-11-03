import { shouldUseSplitCapture } from '../../src/components/imagery/captureLayout';

describe('shouldUseSplitCapture', () => {
  it('uses the split only on a landscape window with an active capture', () => {
    expect(shouldUseSplitCapture({ width: 844, height: 390, capturing: true })).toBe(true);
  });

  it('keeps the portrait band when the window is taller than it is wide', () => {
    expect(shouldUseSplitCapture({ width: 390, height: 844, capturing: true })).toBe(false);
  });

  it('keeps the normal navigation UI when nothing is capturing', () => {
    expect(shouldUseSplitCapture({ width: 844, height: 390, capturing: false })).toBe(false);
  });

  it('rejects unmeasured window dimensions', () => {
    expect(shouldUseSplitCapture({ width: Number.NaN, height: 390, capturing: true })).toBe(false);
    expect(shouldUseSplitCapture({ width: 844, height: Number.NaN, capturing: true })).toBe(false);
  });
});
