/** Over-speed detection with hysteresis, speed-limit change detection, and
 * limit resolution along an active route. */

import type { ValhallaManeuver } from '../../models/route';

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

/**
 * Upper bound for a believable posted limit. Anything above this is a parse
 * artifact (a metric value misread as mph, a sentinel) rather than a sign.
 */
export const MAX_PLAUSIBLE_SPEED_LIMIT_MPH = 200;

/** A posted limit worth showing: finite, positive, and within the bound above. */
export function isPlausibleSpeedLimitMph(limitMph: number | null | undefined): limitMph is number {
  return (
    limitMph != null &&
    Number.isFinite(limitMph) &&
    limitMph > 0 &&
    limitMph <= MAX_PLAUSIBLE_SPEED_LIMIT_MPH
  );
}

type SpeedLimitManeuver = Pick<ValhallaManeuver, 'type' | 'speedLimitMph'>;

/**
 * Posted limit for the road the driver is currently on.
 *
 * Routing engines only attach `speed_limit` at a maneuver's first edge, and
 * only where the source data has `maxspeed` there. Reading just the current
 * maneuver therefore blanks the sign for long stretches of an otherwise
 * well-tagged route — the sign flickers off mid-drive, which is exactly the
 * behaviour a driver reads as "no limit data here".
 *
 * So the last known limit holds forward until a maneuver supplies a new one,
 * the way a posted sign stays in force until the next one. The carry stops at
 * a ferry: the limit before boarding says nothing about the crossing, and a
 * stale road limit on open water is worse than no sign at all.
 */
export function resolveSpeedLimitMph(
  maneuvers: ReadonlyArray<SpeedLimitManeuver>,
  stepIndex: number,
): number | null {
  if (maneuvers.length === 0) return null;
  const start = Math.min(stepIndex, maneuvers.length - 1);
  if (start < 0) return null;

  for (let i = start; i >= 0; i -= 1) {
    const maneuver = maneuvers[i];
    if (maneuver.type === 'ferry') return null;
    if (isPlausibleSpeedLimitMph(maneuver.speedLimitMph)) return maneuver.speedLimitMph;
  }

  return null;
}
