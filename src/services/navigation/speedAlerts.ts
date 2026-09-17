/** Over-speed detection with hysteresis, and speed-limit change detection. */

export interface SpeedAlertOptions {
  /** Speeds at least this far above the limit raise the alert. */
  overThresholdMph?: number;
  /** The alert clears only once back within this margin of the limit. */
  clearThresholdMph?: number;
}

export const DEFAULT_OVER_THRESHOLD_MPH = 5;
export const DEFAULT_CLEAR_THRESHOLD_MPH = 2;

/**
 * Stateful over-speed monitor. Hysteresis prevents the alert from flickering
 * when the speed hovers around the threshold; a single graceful haptic can be
 * fired on the rising edge.
 */
export class OverSpeedMonitor {
  private over = false;

  reset(): void {
    this.over = false;
  }

  /** Returns true while the vehicle is considered over the limit. */
  update(
    currentSpeedMph: number | null | undefined,
    speedLimitMph: number | null | undefined,
    options: SpeedAlertOptions = {},
  ): boolean {
    if (
      speedLimitMph == null ||
      currentSpeedMph == null ||
      !Number.isFinite(currentSpeedMph) ||
      !Number.isFinite(speedLimitMph) ||
      currentSpeedMph <= 0 ||
      speedLimitMph <= 0
    ) {
      this.over = false;
      return false;
    }

    const overThreshold = options.overThresholdMph ?? DEFAULT_OVER_THRESHOLD_MPH;
    const clearThreshold = options.clearThresholdMph ?? DEFAULT_CLEAR_THRESHOLD_MPH;

    if (this.over) {
      if (currentSpeedMph <= speedLimitMph + clearThreshold) this.over = false;
    } else if (currentSpeedMph >= speedLimitMph + overThreshold) {
      this.over = true;
    }

    return this.over;
  }
}

/** True when the posted limit changed (e.g. entering a new zone). */
export function speedLimitChanged(
  previousMph: number | null | undefined,
  nextMph: number | null | undefined,
): boolean {
  return previousMph !== nextMph;
}
