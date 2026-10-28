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

export interface CaptureModeCapabilities {
  /** The back camera exposes an ultra-wide lens. */
  hasUltraWide: boolean;
  /** The user enabled paired telephoto detail frames. */
  detailStream: boolean;
}

/**
 * Picks the capture cadence without asking the user.
 *
 * Standard (20 m, 1080p, wide lens) is what the paired telephoto detail stream
 * needs, so it wins whenever that is enabled. Otherwise the denser 3D cadence
 * runs on devices that expose an ultra-wide lens, and standard is the best a
 * wide-only camera can do.
 */
export function resolveCaptureMode(capabilities: CaptureModeCapabilities): StreetViewCaptureMode {
  if (capabilities.detailStream) return 'standard';
  return capabilities.hasUltraWide ? 'threeD' : 'standard';
}

/** The subset of a VisionCamera `CameraDevice` the detail stream needs. */
export interface DetailCapableDevice {
  maxZoom: number;
  /** Zoom factors at which an iPhone virtual camera switches constituent lens. */
  zoomLensSwitchFactors?: readonly number[];
}

/**
 * The zoom at which a virtual back camera hands over to its telephoto lens —
 * the lowest switch factor above 1× — or null when the device has no tele
 * lens (a dual wide + ultra-wide iPhone, or a real fixed-lens camera).
 *
 * Zooming past 1× on a device without a tele lens only crops the wide sensor,
 * which adds no detail over the wide frame, so the detail stream stays off.
 */
export function detailZoomForDevice(device: DetailCapableDevice | null | undefined): number | null {
  if (!device || !Number.isFinite(device.maxZoom) || device.maxZoom <= 1) return null;
  const telephoto = (device.zoomLensSwitchFactors ?? [])
    .filter((factor) => Number.isFinite(factor) && factor > 1.0001)
    .sort((a, b) => a - b)[0];
  if (telephoto == null || telephoto > device.maxZoom) return null;
  return telephoto;
}

export type DetailCaptureReason =
  | 'ok'
  | 'disabled'
  | 'no-telephoto'
  | 'dash-cam-recording'
  | 'not-due';

export interface DetailCaptureInput {
  /** The user's detail-stream preference. */
  enabled: boolean;
  /** `detailZoomForDevice(device)` — null when this device has no tele lens. */
  detailZoom: number | null;
  /** One detail frame per N wide frames. */
  everyNth: number;
  /** Wide frames captured in this drive, counting the one just taken. */
  wideFrameCount: number;
  /** A dash-cam segment is recording the same session; zooming would show in it. */
  dashCamRecording: boolean;
}

/**
 * Decide whether the wide frame just captured should get a telephoto twin.
 *
 * Every rejected branch keeps the wide stream unchanged, so the feature can
 * never cost the Mapillary sequence a frame.
 */
export function shouldCaptureDetail(input: DetailCaptureInput): {
  capture: boolean;
  reason: DetailCaptureReason;
} {
  if (!input.enabled) return { capture: false, reason: 'disabled' };
  if (input.detailZoom == null) return { capture: false, reason: 'no-telephoto' };
  // The detail frame is a zoom change inside the live session, so it would
  // zoom the dash-cam footage too.
  if (input.dashCamRecording) return { capture: false, reason: 'dash-cam-recording' };
  const everyNth = Math.max(1, Math.floor(input.everyNth));
  if (input.wideFrameCount % everyNth !== 0) return { capture: false, reason: 'not-due' };
  return { capture: true, reason: 'ok' };
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
 * writing these makes the files self-describing.
 *
 * Note: the camera path is VisionCamera, which writes GPS latitude, longitude
 * and the capture time itself via `react-native-vision-camera-location`. This
 * helper is kept as the reference tag set (notably `GPSImgDirection`, which
 * VisionCamera does not write yet) and as the input to a future EXIF post-pass;
 * it is no longer passed to the camera.
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
