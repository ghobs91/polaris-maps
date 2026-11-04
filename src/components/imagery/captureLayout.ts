/**
 * The live capture interface in landscape: a 30% directions pane on the left
 * and the camera on the right. Both the navigation screen (which renders the
 * feed) and CaptureHost (which places the camera pane) derive their layout from
 * these helpers so the two halves cannot disagree.
 */
export const CAPTURE_SPLIT_LEFT_PERCENT = '30%' as const;

/**
 * Zoom presets offered on the camera. Zooming crops the frame, which is the
 * only way to remove the dashboard/hood from a phone mounted low on the glass.
 * Values are relative to the current lens (1x = the lens's native field of
 * view), and 3x is the densest crop offered before digital zoom degrades.
 */
export const CAPTURE_ZOOM_PRESETS = [1, 1.5, 2, 3] as const;

/** Snap an arbitrary persisted value to the nearest supported preset. */
export function clampCaptureZoom(value: number): number {
  if (!Number.isFinite(value)) return CAPTURE_ZOOM_PRESETS[0];
  return CAPTURE_ZOOM_PRESETS.reduce((best, preset) =>
    Math.abs(preset - value) < Math.abs(best - value) ? preset : best,
  );
}

/** Next preset in the cycle, wrapping from the densest crop back to 1x. */
export function nextCaptureZoom(current: number): number {
  const index = CAPTURE_ZOOM_PRESETS.indexOf(
    clampCaptureZoom(current) as (typeof CAPTURE_ZOOM_PRESETS)[number],
  );
  return CAPTURE_ZOOM_PRESETS[(index + 1) % CAPTURE_ZOOM_PRESETS.length];
}

/**
 * Photo target resolution for a zoom preset.
 *
 * A sensor-level zoom crops the active region to about 1/zoom² of the full
 * 12 MP sensor. Asking for a full-size buffer at that zoom makes the ISP
 * upscale the crop back to 12 MP — the uniform softness of digitally zoomed
 * street imagery. Asking for a buffer at the cropped region's native size (or
 * slightly below, so the ISP downscales instead) keeps every stored still on
 * real pixels while keeping the dash crop.
 */
export const CAPTURE_PHOTO_TARGETS: Readonly<Record<number, { width: number; height: number }>> = {
  1: { width: 3024, height: 4032 }, // full 12 MP sensor
  1.5: { width: 1944, height: 2592 }, // ~2016x2688 crop region
  2: { width: 1440, height: 1920 }, // ~1512x2016 crop region
  3: { width: 768, height: 1024 }, // ~1008x1344 crop region
};

/** The photo resolution tier whose pixel budget matches a zoomed sensor crop. */
export function capturePhotoTargetForZoom(zoom: number): { width: number; height: number } {
  const clamped = clampCaptureZoom(zoom);
  return CAPTURE_PHOTO_TARGETS[clamped] ?? CAPTURE_PHOTO_TARGETS[1];
}

/**
 * Video/preview target for a zoom preset, on the same principle as the still
 * tiers: the stream is fed from the cropped sensor region, so a target larger
 * than that region makes the ISP upscale it (soft preview), while a target at
 * or below the region keeps real pixels. 4K is only correct at 1x.
 */
export const CAPTURE_VIDEO_TARGETS: Readonly<Record<number, { width: number; height: number }>> = {
  1: { width: 2160, height: 3840 }, // 4K, source is the full sensor
  1.5: { width: 1440, height: 2560 }, // QHD, source crop ~2688x1512
  2: { width: 1080, height: 1920 }, // FHD, source crop ~2016x1134
  3: { width: 720, height: 1280 }, // HD, source crop ~1344x756
};

/** The video/preview resolution tier whose pixel budget matches a zoomed crop. */
export function captureVideoTargetForZoom(zoom: number): { width: number; height: number } {
  const clamped = clampCaptureZoom(zoom);
  return CAPTURE_VIDEO_TARGETS[clamped] ?? CAPTURE_VIDEO_TARGETS[1];
}

/** The subset of a VisionCamera device needed to find the road camera. */
export interface RoadCameraDeviceLike {
  position: string;
  type: string;
  isVirtualDevice: boolean;
}

/**
 * Pick the single physical wide-angle camera.
 *
 * VisionCamera's `physicalDevices` filter cannot express "physical only": a
 * physical lens has an empty constituent list (score 0) and a virtual dual-wide
 * scores 0 too, so the filter may still return a virtual camera — the exact
 * device whose manual lens-position lock is unavailable. Filter on
 * `type === 'wide-angle' && !isVirtualDevice` instead.
 */
export function pickRoadCameraDevice<T extends RoadCameraDeviceLike>(
  devices: readonly T[],
): T | undefined {
  return devices.find(
    (device) =>
      device.position === 'back' && device.type === 'wide-angle' && !device.isVirtualDevice,
  );
}

export interface SplitCaptureInput {
  /** Window width in points. */
  width: number;
  /** Window height in points. */
  height: number;
  /** Street imagery or dash-cam capture is running. */
  capturing: boolean;
}

/**
 * True on a landscape navigation screen while a capture is active. Portrait
 * keeps the map + bottom capture band (with the rotate prompt); landscape
 * replaces the map with the directions/camera split.
 */
export function shouldUseSplitCapture(input: SplitCaptureInput): boolean {
  const { width, height, capturing } = input;
  if (!capturing) return false;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width > height;
}
