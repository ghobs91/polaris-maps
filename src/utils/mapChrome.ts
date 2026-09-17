import { metersPerPixel } from './poiClustering';

/** Normalize a bearing into the range (-180, 180], where 0 is north. */
export function normalizeHeading(bearing: number): number {
  const wrapped = ((bearing % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** True when the compass should be shown (map rotated or tilted). */
export function compassVisible(bearing: number, pitch: number, thresholdDeg = 2): boolean {
  return Math.abs(normalizeHeading(bearing)) > thresholdDeg || Math.abs(pitch) > 0.5;
}

/** "Nice" round distances (metres) for a scale bar. */
export const NICE_SCALE_STEPS_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000,
  1_000_000,
];

export interface ScaleBar {
  /** Round distance represented by the bar, in metres. */
  metres: number;
  /** Bar width in pixels for the current zoom/latitude. */
  widthPx: number;
}

/**
 * Compute a scale bar that is at most `maxPixels` wide at the given zoom and
 * latitude, using the largest "nice" round distance that fits.
 */
export function computeScaleBar(zoom: number, lat: number, maxPixels = 64): ScaleBar {
  const perPixel = metersPerPixel(zoom, lat);
  const maxMetres = perPixel * maxPixels;

  let metres = NICE_SCALE_STEPS_M[0];
  for (const step of NICE_SCALE_STEPS_M) {
    if (step <= maxMetres) metres = step;
  }

  const widthPx = Math.min(maxPixels, metres / perPixel);
  return { metres, widthPx };
}
