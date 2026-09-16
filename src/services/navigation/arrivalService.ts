import { haversineMeters } from '../../utils/routeSnap';

/** Straight-line proximity that counts as "at" the target. */
export const ARRIVAL_RADIUS_METERS = 45;
/** Sustained fixes required before declaring arrival (debounce). */
export const ARRIVAL_CONSECUTIVE_FIXES = 2;

export interface ArrivalCheck {
  /** Straight-line distance to the target in metres, or null when there is no GPS fix. */
  distanceToTargetMeters: number | null;
  /**
   * Remaining along-route distance to the target in metres, when known.
   * Used to reject "near-pass" false positives (e.g. a parallel road within
   * the radius while the route still has a long way to go).
   */
  remainingMetersToTarget: number | null;
}

export interface ArrivalOptions {
  radiusMeters?: number;
  consecutiveFixes?: number;
}

/**
 * Stateful, debounced arrival detector. Feed it successive fixes; it returns
 * true once the arrival criteria are sustained for the required number of
 * consecutive fixes, then latches until reset.
 */
export class ArrivalDetector {
  private consecutive = 0;
  private arrived = false;

  reset(): void {
    this.consecutive = 0;
    this.arrived = false;
  }

  update(check: ArrivalCheck, options: ArrivalOptions = {}): boolean {
    if (this.arrived) return true;

    const radius = options.radiusMeters ?? ARRIVAL_RADIUS_METERS;
    const required = options.consecutiveFixes ?? ARRIVAL_CONSECUTIVE_FIXES;

    // GPS loss — never count a stale/invalid fix toward arrival.
    if (check.distanceToTargetMeters == null) {
      this.consecutive = 0;
      return false;
    }

    const withinRadius = check.distanceToTargetMeters <= radius;
    // When route progress is known, require the vehicle to actually be near the
    // end of the route so a close pass on an adjacent road does not trigger.
    const nearEnd =
      check.remainingMetersToTarget == null || check.remainingMetersToTarget <= radius * 2;
    const candidate = withinRadius && nearEnd;

    this.consecutive = candidate ? this.consecutive + 1 : 0;
    if (this.consecutive >= required) {
      this.arrived = true;
      return true;
    }
    return false;
  }
}

/** Simple helper for callers that already have a position and target. */
export function distanceToTargetMeters(
  position: [number, number] | null,
  target: { lat: number; lng: number } | null,
): number | null {
  if (!position || !target) return null;
  return haversineMeters(position, [target.lng, target.lat]);
}

/**
 * Resolve the next target for the current leg: an intermediate waypoint while
 * legs remain, otherwise the final destination.
 */
export function targetForLeg(
  waypoints: ReadonlyArray<{ lat: number; lng: number }>,
  destination: { lat: number; lng: number } | null,
  currentLegIndex: number,
): { lat: number; lng: number } | null {
  if (currentLegIndex < waypoints.length) return waypoints[currentLegIndex];
  return destination;
}
