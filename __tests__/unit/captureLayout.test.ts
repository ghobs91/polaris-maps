import {
  CAPTURE_ZOOM_PRESETS,
  capturePhotoTargetForZoom,
  clampCaptureZoom,
  nextCaptureZoom,
  shouldUseSplitCapture,
} from '../../src/components/imagery/captureLayout';

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

describe('capture zoom', () => {
  it('offers 1x through 3x crops', () => {
    expect(CAPTURE_ZOOM_PRESETS).toEqual([1, 1.5, 2, 3]);
  });

  it('snaps persisted values to the nearest preset', () => {
    expect(clampCaptureZoom(1.24)).toBe(1);
    expect(clampCaptureZoom(1.26)).toBe(1.5);
    expect(clampCaptureZoom(2.7)).toBe(3);
    expect(clampCaptureZoom(99)).toBe(3);
    expect(clampCaptureZoom(Number.NaN)).toBe(1);
  });

  it('cycles through every preset and wraps', () => {
    expect(nextCaptureZoom(1)).toBe(1.5);
    expect(nextCaptureZoom(1.5)).toBe(2);
    expect(nextCaptureZoom(2)).toBe(3);
    expect(nextCaptureZoom(3)).toBe(1);
  });
});

describe('capturePhotoTargetForZoom', () => {
  it('uses the full sensor at 1x', () => {
    expect(capturePhotoTargetForZoom(1)).toEqual({ width: 3024, height: 4032 });
  });

  it('drops a tier per zoom so a crop is not interpolated back up', () => {
    expect(capturePhotoTargetForZoom(1.5)).toEqual({ width: 1944, height: 2592 });
    expect(capturePhotoTargetForZoom(2)).toEqual({ width: 1440, height: 1920 });
    expect(capturePhotoTargetForZoom(3)).toEqual({ width: 768, height: 1024 });
  });

  it('snaps odd values to the nearest preset tier', () => {
    expect(capturePhotoTargetForZoom(1.7)).toEqual({ width: 1944, height: 2592 });
    expect(capturePhotoTargetForZoom(Number.NaN)).toEqual({ width: 3024, height: 4032 });
  });

  it('never exceeds the pixel budget of the zoomed region', () => {
    for (const zoom of CAPTURE_ZOOM_PRESETS) {
      const target = capturePhotoTargetForZoom(zoom);
      expect(target.width * target.height).toBeLessThanOrEqual(3024 * 4032);
    }
  });
});
