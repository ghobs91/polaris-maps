import {
  guidanceManeuver,
  guidanceManeuverIndex,
  followingManeuver,
} from '../../src/utils/navigationManeuvers';
import type { ManeuverType, ValhallaManeuver } from '../../src/models/route';

function makeManeuver(type: ManeuverType, instruction: string): ValhallaManeuver {
  return {
    type,
    instruction,
    distanceMeters: 100,
    durationSeconds: 10,
    beginShapeIndex: 0,
    endShapeIndex: 1,
  };
}

const maneuvers = [
  makeManeuver('start', 'Head north'),
  makeManeuver('turn_right', 'Turn right'),
  makeManeuver('destination', 'Arrive'),
];

describe('navigationManeuvers', () => {
  it('guides to the NEXT maneuver, since the distance counts down to its begin', () => {
    expect(guidanceManeuverIndex(0, maneuvers)).toBe(1);
    expect(guidanceManeuverIndex(1, maneuvers)).toBe(2);
  });

  it('clamps to the last maneuver', () => {
    expect(guidanceManeuverIndex(2, maneuvers)).toBe(2);
    expect(guidanceManeuverIndex(99, maneuvers)).toBe(2);
  });

  it('returns the guidance and following maneuvers', () => {
    expect(guidanceManeuver(0, maneuvers)?.instruction).toBe('Turn right');
    expect(followingManeuver(0, maneuvers)?.instruction).toBe('Arrive');
    expect(followingManeuver(1, maneuvers)).toBeNull();
  });

  it('handles empty lists', () => {
    expect(guidanceManeuverIndex(0, [])).toBe(0);
    expect(guidanceManeuver(0, [])).toBeNull();
    expect(followingManeuver(0, [])).toBeNull();
  });
});
