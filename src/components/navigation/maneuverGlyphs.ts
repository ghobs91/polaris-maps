/**
 * Icon vocabulary for the navigation guidance surfaces.
 *
 * Deliberately free of React Native imports so the glyph names can be checked
 * against the font's own glyph map in a unit test: a misspelled icon name
 * renders as a blank box at runtime and logs nothing.
 *
 * Everything comes from MaterialCommunityIcons, so the maneuver arrow and the
 * lane strip beneath it share one arrow design — the previous mix of rotated
 * Ionicons `arrow-up` glyphs had a thin shaft and a small head that read as
 * dated next to the card's other type.
 */
import type { LaneDirection, ManeuverType } from '../../models/route';

export interface Glyph {
  /** MaterialCommunityIcons glyph name. */
  name: string;
  /** Degrees clockwise. Glyphs are drawn pointing up unless noted otherwise. */
  rotate: number;
}

/**
 * Exhaustive by construction: adding a `ManeuverType` without a glyph here is
 * a compile error, so the union and this table cannot drift apart.
 */
const MANEUVER_GLYPHS: Record<ManeuverType, Glyph> = {
  start: { name: 'arrow-up-bold', rotate: 0 },
  destination: { name: 'flag-checkered', rotate: 0 },
  turn_left: { name: 'arrow-up-bold', rotate: -90 },
  turn_right: { name: 'arrow-up-bold', rotate: 90 },
  sharp_left: { name: 'arrow-up-bold', rotate: -135 },
  sharp_right: { name: 'arrow-up-bold', rotate: 135 },
  slight_left: { name: 'arrow-up-bold', rotate: -45 },
  slight_right: { name: 'arrow-up-bold', rotate: 45 },
  continue: { name: 'arrow-up-bold', rotate: 0 },
  // The one glyph that is already directional, so it takes no rotation.
  u_turn: { name: 'arrow-u-left-top', rotate: 0 },
  merge_left: { name: 'arrow-up-bold', rotate: -30 },
  merge_right: { name: 'arrow-up-bold', rotate: 30 },
  enter_roundabout: { name: 'rotate-right', rotate: 0 },
  exit_roundabout: { name: 'rotate-right', rotate: 0 },
  enter_highway: { name: 'arrow-up-bold', rotate: 0 },
  // Already points up-and-right, so it needs no rotation.
  exit_highway: { name: 'arrow-top-right-thick', rotate: 0 },
  ferry: { name: 'ferry', rotate: 0 },
  name_change: { name: 'arrow-up-bold', rotate: 0 },
};

/**
 * Glyph for a maneuver. Falls back to the straight-ahead arrow for a type the
 * router sends that this build does not know (the union is compile-time only,
 * and Valhalla's leg could still carry something new).
 */
export function maneuverGlyph(type: ManeuverType | undefined | null): Glyph {
  return (type && MANEUVER_GLYPHS[type]) || MANEUVER_GLYPHS.continue;
}

/** Degrees clockwise for each lane arrow; every one is drawn pointing up. */
const LANE_ROTATIONS: Record<LaneDirection, number> = {
  left: -90,
  slight_left: -45,
  straight: 0,
  slight_right: 45,
  right: 90,
  merge_left: -30,
  merge_right: 30,
  u_turn: 0,
};

/**
 * Lane arrow glyph. The recommended lane reads heavier as well as brighter so
 * the strip still parses in bright sun, where an opacity difference alone
 * washes out. `arrow-u-left-top` has no weight pair, so a U-turn lane looks
 * the same either way.
 */
export function laneGlyph(direction: LaneDirection, active: boolean): Glyph {
  const rotate = LANE_ROTATIONS[direction] ?? 0;
  if (direction === 'u_turn') return { name: 'arrow-u-left-top', rotate };
  return { name: active ? 'arrow-up-bold' : 'arrow-up-thin', rotate };
}

/** Every maneuver type this module can render, for exhaustiveness checking. */
export const MANEUVER_TYPES = Object.keys(MANEUVER_GLYPHS) as ManeuverType[];

/** Every lane direction this module can render, for exhaustiveness checking. */
export const LANE_DIRECTIONS = Object.keys(LANE_ROTATIONS) as LaneDirection[];
