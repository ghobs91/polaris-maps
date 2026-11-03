/**
 * The live capture interface in landscape: a 30% directions pane on the left
 * and the camera on the right. Both the navigation screen (which renders the
 * feed) and CaptureHost (which places the camera pane) derive their layout from
 * these helpers so the two halves cannot disagree.
 */
export const CAPTURE_SPLIT_LEFT_PERCENT = '30%' as const;

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
