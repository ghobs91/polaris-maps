import {
  buildCaptureExif,
  captureConfigForMode,
  detailZoomForDevice,
  formatExifDate,
  formatExifDateTime,
  formatExifTime,
  isDrivingCosting,
  shouldCapture,
  shouldCaptureDetail,
} from '../../src/services/imagery/streetViewCaptureLogic';
import type { StreetViewFix } from '../../src/models/streetViewCapture';

const FIX: StreetViewFix = {
  lat: 40.7128,
  lng: -74.006,
  altitude: 12.5,
  heading: 87.5,
  speedMps: 13.9,
  accuracyMeters: 8,
  timestamp: Date.UTC(2026, 9, 23, 14, 5, 9, 123),
};

describe('isDrivingCosting', () => {
  it('only enables capture for road driving', () => {
    expect(isDrivingCosting('auto')).toBe(true);
    expect(isDrivingCosting('pedestrian')).toBe(false);
    expect(isDrivingCosting('bicycle')).toBe(false);
    expect(isDrivingCosting('transit')).toBe(false);
  });
});

describe('shouldCapture', () => {
  const config = captureConfigForMode('standard');

  it('captures the first moving fix', () => {
    expect(shouldCapture(FIX, null, FIX.timestamp, config)).toEqual({
      capture: true,
      reason: 'ok',
    });
  });

  it('rejects a missing fix', () => {
    expect(shouldCapture(null, null, FIX.timestamp, config).reason).toBe('no-fix');
  });

  it('rejects a noisy fix', () => {
    const noisy = { ...FIX, accuracyMeters: config.maxAccuracyMeters + 1 };
    expect(shouldCapture(noisy, null, FIX.timestamp, config).reason).toBe('poor-accuracy');
  });

  it('rejects a stopped vehicle', () => {
    const stopped = { ...FIX, speedMps: config.minSpeedMps - 0.1 };
    expect(shouldCapture(stopped, null, FIX.timestamp, config).reason).toBe('too-slow');
  });

  it('rejects a second frame inside the minimum interval', () => {
    const last = { lat: FIX.lat, lng: FIX.lng, capturedAt: FIX.timestamp - 100 };
    expect(shouldCapture(FIX, last, FIX.timestamp, config).reason).toBe('too-soon');
  });

  it('rejects a frame before the distance threshold', () => {
    const last = {
      lat: FIX.lat - 0.00005, // ~5.5 m
      lng: FIX.lng,
      capturedAt: FIX.timestamp - 5000,
    };
    const decision = shouldCapture(FIX, last, FIX.timestamp, config);
    expect(decision.capture).toBe(false);
    expect(decision.reason).toBe('not-far-enough');
  });

  it('captures once the distance threshold is crossed', () => {
    const last = {
      lat: FIX.lat - 0.0003, // ~33 m
      lng: FIX.lng,
      capturedAt: FIX.timestamp - 5000,
    };
    expect(shouldCapture(FIX, last, FIX.timestamp, config).capture).toBe(true);
  });

  it('uses denser spacing in 3D mode', () => {
    const threeD = captureConfigForMode('threeD');
    const last = {
      lat: FIX.lat - 0.0001, // ~11 m: too close for standard, far enough for 3D
      lng: FIX.lng,
      capturedAt: FIX.timestamp - 3000,
    };
    expect(shouldCapture(FIX, last, FIX.timestamp, threeD).capture).toBe(true);
  });
});

describe('detailZoomForDevice', () => {
  it('uses the telephoto switch-over factor of a triple camera', () => {
    expect(detailZoomForDevice({ maxZoom: 12, zoomLensSwitchFactors: [0.5, 1, 3] })).toBe(3);
  });

  it('takes the lowest factor above 1x when a device has several', () => {
    expect(detailZoomForDevice({ maxZoom: 15, zoomLensSwitchFactors: [0.5, 1, 2, 5] })).toBe(2);
  });

  it('returns null for a camera without a telephoto lens', () => {
    expect(detailZoomForDevice({ maxZoom: 5, zoomLensSwitchFactors: [0.5, 1] })).toBeNull();
  });

  it('returns null when the device cannot zoom past 1x', () => {
    expect(detailZoomForDevice({ maxZoom: 1, zoomLensSwitchFactors: [1] })).toBeNull();
  });

  it('returns null when the switch factor is outside the device range', () => {
    expect(detailZoomForDevice({ maxZoom: 2, zoomLensSwitchFactors: [1, 3] })).toBeNull();
  });

  it('returns null without a device', () => {
    expect(detailZoomForDevice(undefined)).toBeNull();
  });
});

describe('shouldCaptureDetail', () => {
  const base = {
    enabled: true,
    detailZoom: 3,
    everyNth: 5,
    wideFrameCount: 5,
    dashCamRecording: false,
  };

  it('captures on every Nth wide frame', () => {
    expect(shouldCaptureDetail(base)).toEqual({ capture: true, reason: 'ok' });
  });

  it('skips frames between the cadence', () => {
    expect(shouldCaptureDetail({ ...base, wideFrameCount: 4 }).reason).toBe('not-due');
  });

  it('stays off when the preference is off', () => {
    expect(shouldCaptureDetail({ ...base, enabled: false }).reason).toBe('disabled');
  });

  it('stays off on a device without a telephoto lens', () => {
    expect(shouldCaptureDetail({ ...base, detailZoom: null }).reason).toBe('no-telephoto');
  });

  it('stays off while the dash cam records the same session', () => {
    expect(shouldCaptureDetail({ ...base, dashCamRecording: true }).reason).toBe(
      'dash-cam-recording',
    );
  });

  it('treats a cadence below one as every frame', () => {
    expect(shouldCaptureDetail({ ...base, everyNth: 0 }).capture).toBe(true);
  });
});

describe('EXIF formatting', () => {
  it('formats UTC GPS date and time', () => {
    expect(formatExifDate(FIX.timestamp)).toBe('2026:10:23');
    expect(formatExifTime(FIX.timestamp)).toBe('14:05:09');
  });

  it('writes GPS, time, heading and accuracy tags', () => {
    const exif = buildCaptureExif(FIX, FIX.timestamp);
    expect(exif.GPSLatitude).toBe(FIX.lat);
    expect(exif.GPSLongitude).toBe(FIX.lng);
    expect(exif.GPSImgDirection).toBe(87.5);
    expect(exif.GPSImgDirectionRef).toBe('T');
    expect(exif.GPSHPositioningError).toBe(8);
    expect(exif.GPSAltitude).toBe(12.5);
    expect(exif.GPSDateStamp).toBe('2026:10:23');
    expect(exif.GPSTimeStamp).toEqual([14, 5, 9]);
    expect(exif.SubSecTimeOriginal).toBe('123');
    expect(String(exif.DateTimeOriginal)).toMatch(/^2026:10:23 \d{2}:\d{2}:\d{2}$/);
  });

  it('uses the fallback heading when GPS heading is unavailable', () => {
    const exif = buildCaptureExif({ ...FIX, heading: null }, FIX.timestamp, 181.4);
    expect(exif.GPSImgDirection).toBe(181.4);
  });

  it('omits direction rather than fabricating one', () => {
    const exif = buildCaptureExif({ ...FIX, heading: null }, FIX.timestamp, null);
    expect(exif.GPSImgDirection).toBeUndefined();
    expect(exif.GPSImgDirectionRef).toBeUndefined();
  });

  it('normalizes a negative heading', () => {
    const exif = buildCaptureExif({ ...FIX, heading: -10 }, FIX.timestamp);
    expect(exif.GPSImgDirection).toBe(350);
  });
});

describe('formatExifDateTime', () => {
  it('returns a parseable EXIF local timestamp', () => {
    expect(formatExifDateTime(Date.UTC(2026, 0, 2, 3, 4, 5))).toMatch(
      /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});
