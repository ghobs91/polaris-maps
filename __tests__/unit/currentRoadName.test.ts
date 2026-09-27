import {
  currentRoadName,
  followingManeuver,
  guidanceManeuver,
} from '../../src/utils/navigationManeuvers';
import type { ValhallaManeuver } from '../../src/models/route';

function maneuver(type: ValhallaManeuver['type'], streetNames?: string[]): ValhallaManeuver {
  return {
    type,
    instruction: type,
    distanceMeters: 100,
    durationSeconds: 10,
    beginShapeIndex: 0,
    endShapeIndex: 1,
    verbalPreTransition: type,
    ...(streetNames ? { streetNames } : {}),
  };
}

/**
 * A three-turn route. `streetNames` is the street a maneuver turns ONTO, so the
 * road under the car is named by the maneuver it has already reached.
 */
const route: ValhallaManeuver[] = [
  maneuver('start', ['Main St']),
  maneuver('turn_right', ['Oak Ave']),
  maneuver('turn_left', ['Elm St']),
  maneuver('destination', ['Elm St']),
];

describe('currentRoadName', () => {
  it('names the road the vehicle is on, not the one it is turning onto', () => {
    // Step 0 = the start segment: driving along Main St toward the Oak Ave turn.
    expect(currentRoadName(0, route)).toBe('Main St');
  });

  it('advances with the step index', () => {
    // Once the Oak Ave turn is reached, Oak Ave is the road under the car.
    expect(currentRoadName(1, route)).toBe('Oak Ave');
    expect(currentRoadName(2, route)).toBe('Elm St');
  });

  it('names a different road from the one the banner is announcing', () => {
    // The whole point of the pill: at step 0 the driver is on Main St while the
    // banner is already telling them to turn onto Oak Ave.
    const bannerStreet = guidanceManeuver(0, route)?.streetNames?.[0];
    expect(currentRoadName(0, route)).toBe('Main St');
    expect(bannerStreet).toBe('Oak Ave');
    expect(currentRoadName(0, route)).not.toBe(bannerStreet);
  });

  it('returns null for an unnamed road rather than an empty string', () => {
    const unnamed = [maneuver('start'), maneuver('turn_right', ['Oak Ave'])];
    expect(currentRoadName(0, unnamed)).toBeNull();
    expect(currentRoadName(0, [maneuver('start', ['   '])])).toBeNull();
  });

  it('returns null when the step index has run past the route', () => {
    expect(currentRoadName(99, route)).toBeNull();
    expect(currentRoadName(0, [])).toBeNull();
  });

  it('tolerates a negative step index', () => {
    // Maneuvers[negative] is undefined, so the pill drops rather than throwing.
    expect(currentRoadName(-1, route)).toBeNull();
  });
});

describe('followingManeuver', () => {
  it('is the maneuver after the guidance one', () => {
    expect(followingManeuver(0, route)).toBe(route[2]);
    expect(followingManeuver(1, route)).toBe(route[3]);
  });

  it('is null at the end of the route', () => {
    expect(followingManeuver(2, route)).toBeNull();
    expect(followingManeuver(3, route)).toBeNull();
  });
});
