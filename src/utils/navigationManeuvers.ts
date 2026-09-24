import type { ValhallaManeuver } from '../models/route';

/**
 * Index of the maneuver the driver should act on next.
 *
 * `navigationStore.currentStepIndex` advances when the vehicle reaches a
 * maneuver's `beginShapeIndex`, so it identifies the segment the vehicle is
 * already on. A Valhalla maneuver's instruction is performed at its
 * `beginShapeIndex`, so the action paired with the live distance-to-turn (which
 * counts down to the end of the current segment = the next maneuver's begin) is
 * the NEXT maneuver. Guidance (banner, voice, CarPlay, Live Activity) therefore
 * uses this index; the raw step index stays for step-list progress and the
 * turn-point haptic.
 */
export function guidanceManeuverIndex(
  currentStepIndex: number,
  maneuvers: ReadonlyArray<ValhallaManeuver>,
): number {
  if (maneuvers.length === 0) return 0;
  return Math.min(Math.max(currentStepIndex, 0) + 1, maneuvers.length - 1);
}

/** The maneuver to guide to next, falling back to the current one. */
export function guidanceManeuver(
  currentStepIndex: number,
  maneuvers: ReadonlyArray<ValhallaManeuver>,
): ValhallaManeuver | null {
  if (maneuvers.length === 0) return null;
  return maneuvers[guidanceManeuverIndex(currentStepIndex, maneuvers)] ?? null;
}

/** The maneuver after the guidance one ("Then …"). */
export function followingManeuver(
  currentStepIndex: number,
  maneuvers: ReadonlyArray<ValhallaManeuver>,
): ValhallaManeuver | null {
  const index = guidanceManeuverIndex(currentStepIndex, maneuvers);
  return maneuvers[index + 1] ?? null;
}
