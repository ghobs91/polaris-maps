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

/**
 * Name of the road the vehicle is travelling on right now.
 *
 * `currentStepIndex` identifies the segment the vehicle has already reached,
 * and a maneuver's `streetNames` is the street that maneuver turns onto — the
 * same reading {@link followingManeuver} relies on for the banner's "Then"
 * row. So the maneuver at the current index names the road being driven; the
 * next maneuver's street is what the banner is already announcing, which is
 * why this is not simply the guidance maneuver's name.
 *
 * Returns null when the road is unnamed or not yet known, so callers can drop
 * the pill rather than render an empty one.
 */
export function currentRoadName(
  currentStepIndex: number,
  maneuvers: ReadonlyArray<ValhallaManeuver>,
): string | null {
  const current = maneuvers[currentStepIndex];
  const name = current?.streetNames?.[0]?.trim();
  return name ? name : null;
}
