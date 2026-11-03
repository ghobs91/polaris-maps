/**
 * The portrait capture band (camera preview + recording controls) owns the
 * bottom quarter of the navigation screen while a capture is active. In
 * landscape navigation the camera moves into the right 70% pane instead
 * (see `captureLayout.ts`); every screen that shows content at the bottom in
 * portrait must reserve this height instead of being covered by it.
 */
export const CAPTURE_BAND_SCREEN_FRACTION = 0.25;
/** Never shrink the band below a usable height on small screens. */
export const CAPTURE_BAND_MIN_HEIGHT = 150;

/** Height of the live capture band for a given window height. */
export function captureBandHeight(windowHeight: number): number {
  return Math.max(CAPTURE_BAND_MIN_HEIGHT, Math.round(windowHeight * CAPTURE_BAND_SCREEN_FRACTION));
}
