import { haversineMeters } from '../../utils/routeSnap';
import { navigationModeForCosting } from '../../utils/navigationMode';
import type { CostingModel } from '../../models/route';
import {
  STREET_VIEW_MODE_CONFIG,
  type StreetViewCaptureConfig,
  type StreetViewCaptureMode,
  type StreetViewFix,
} from '../../models/streetViewCapture';

export interface LastCapture {
  lat: number;
  lng: number;
  capturedAt: number;
}

export interface CaptureDecision {
  capture: boolean;
  reason: 'ok' | 'no-fix' | 'poor-accuracy' | 'too-slow' | 'too-soon' | 'not-far-enough';
  distanceMeters?: number;
}

/** True for turn-by-turn road driving, the only mode this feature supports. */
export function isDrivingCosting(costing: CostingModel): boolean {
  return navigationModeForCosting(costing) === 'driving';
}

export function captureConfigForMode(mode: StreetViewCaptureMode): StreetViewCaptureConfig {
  return STREET_VIEW_MODE_CONFIG[mode] ?? STREET_VIEW_MODE_CONFIG.standard;
}

/**
 * Decide whether a raw GPS fix should produce a frame.
 *
 * The defaults are deliberately conservative: no frames at a red light, no
 * frames from a noisy fix, and no backlog when the camera is still busy. The
 * caller tracks `busy` separately; this function only handles movement rules.
 */
export function shouldCapture(
  fix: StreetViewFix | null,
  lastCapture: LastCapture | null,
  now: number,
  config: StreetViewCaptureConfig,
): CaptureDecision {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return { capture: false, reason: 'no-fix' };
  }
  if (
    fix.accuracyMeters != null &&
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters > config.maxAccuracyMeters
  ) {
    return { capture: false, reason: 'poor-accuracy' };
  }
  if (!Number.isFinite(fix.speedMps) || fix.speedMps < config.minSpeedMps) {
    return { capture: false, reason: 'too-slow' };
  }

  if (!lastCapture) return { capture: true, reason: 'ok' };

  const elapsed = now - lastCapture.capturedAt;
  if (elapsed < config.minIntervalMs) {
    return { capture: false, reason: 'too-soon' };
  }

  const distanceMeters = haversineMeters([lastCapture.lng, lastCapture.lat], [fix.lng, fix.lat]);
  if (distanceMeters < config.distanceMeters) {
    return { capture: false, reason: 'not-far-enough', distanceMeters };
  }
  return { capture: true, reason: 'ok', distanceMeters };
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY:MM:DD` in UTC, the EXIF GPSDateStamp format. */
export function formatExifDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}:${two(date.getUTCMonth() + 1)}:${two(date.getUTCDate())}`;
}

/** `HH:MM:SS` in UTC, the EXIF GPSTimeStamp format. */
export function formatExifTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`;
}

/** `YYYY:MM:DD HH:MM:SS` in local time, the EXIF DateTimeOriginal format. */
export function formatExifDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    `${date.getFullYear()}:${two(date.getMonth() + 1)}:${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

function normalizeHeading(heading: number | null | undefined): number | null {
  if (heading == null || !Number.isFinite(heading)) return null;
  const normalized = ((heading % 360) + 360) % 360;
  return Math.round(normalized * 1000) / 1000;
}

/**
 * EXIF tags written at capture time. Mapillary needs GPS + capture time;
 * Panoramax can also use upload overrides, but writing these makes the files
 * self-describing and keeps both platforms correct.
 */
export function buildCaptureExif(
  fix: StreetViewFix,
  capturedAt: number,
  fallbackHeading?: number | null,
): Record<string, string | number | number[]> {
  const date = new Date(capturedAt);
  // iOS CoreGraphics expects the GPS time stamp as an array of three numbers;
  // Android's ExifInterface path ignores the array and falls back to
  // DateTimeOriginal, which both platforms accept as capture time.
  const exif: Record<string, string | number | number[]> = {
    GPSLatitude: fix.lat,
    GPSLongitude: fix.lng,
    GPSDateStamp: formatExifDate(capturedAt),
    GPSTimeStamp: [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()],
    DateTimeOriginal: formatExifDateTime(capturedAt),
    SubSecTimeOriginal: String(date.getMilliseconds()).padStart(3, '0'),
  };

  if (fix.accuracyMeters != null && Number.isFinite(fix.accuracyMeters)) {
    exif.GPSHPositioningError = fix.accuracyMeters;
  }
  if (fix.altitude != null && Number.isFinite(fix.altitude)) {
    exif.GPSAltitude = fix.altitude;
  }

  const heading = normalizeHeading(fix.heading ?? fallbackHeading);
  if (heading != null) {
    exif.GPSImgDirection = heading;
    exif.GPSImgDirectionRef = 'T';
  }
  return exif;
}
