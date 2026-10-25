import {
  buildCaptureExif,
  captureConfigForMode,
  formatExifDate,
  formatExifDateTime,
  formatExifTime,
  isDrivingCosting,
  shouldCapture,
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
