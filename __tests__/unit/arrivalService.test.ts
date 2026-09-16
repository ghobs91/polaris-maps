import {
  ArrivalDetector,
  distanceToTargetMeters,
  targetForLeg,
} from '../../src/services/navigation/arrivalService';

describe('ArrivalDetector', () => {
  it('declares arrival only after the required consecutive fixes within radius', () => {
    const detector = new ArrivalDetector();
    const check = { distanceToTargetMeters: 25, remainingMetersToTarget: 20 };

    expect(detector.update(check)).toBe(false);
    expect(detector.update(check)).toBe(true);
  });

  it('does not trigger on a near pass when the route still has a long way to go', () => {
    const detector = new ArrivalDetector();
    const check = { distanceToTargetMeters: 25, remainingMetersToTarget: 2_000 };

    expect(detector.update(check)).toBe(false);
    expect(detector.update(check)).toBe(false);
    expect(detector.update(check)).toBe(false);
  });

  it('resets the streak when a fix is outside the radius', () => {
    const detector = new ArrivalDetector();
    expect(detector.update({ distanceToTargetMeters: 20, remainingMetersToTarget: 10 })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: 500, remainingMetersToTarget: 480 })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: 20, remainingMetersToTarget: 10 })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: 20, remainingMetersToTarget: 10 })).toBe(true);
  });

  it('ignores GPS loss and resets the streak', () => {
    const detector = new ArrivalDetector();
    expect(detector.update({ distanceToTargetMeters: 20, remainingMetersToTarget: 10 })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: null, remainingMetersToTarget: null })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: 20, remainingMetersToTarget: 10 })).toBe(
      false,
    );
  });

  it('treats radius as sufficient when route progress is unknown', () => {
    const detector = new ArrivalDetector();
    expect(detector.update({ distanceToTargetMeters: 30, remainingMetersToTarget: null })).toBe(
      false,
    );
    expect(detector.update({ distanceToTargetMeters: 30, remainingMetersToTarget: null })).toBe(
      true,
    );
  });

  it('latches until reset', () => {
    const detector = new ArrivalDetector();
    detector.update({ distanceToTargetMeters: 10, remainingMetersToTarget: 5 });
    expect(detector.update({ distanceToTargetMeters: 10, remainingMetersToTarget: 5 })).toBe(true);
    expect(detector.update({ distanceToTargetMeters: 900, remainingMetersToTarget: 900 })).toBe(
      true,
    );
    detector.reset();
    expect(detector.update({ distanceToTargetMeters: 900, remainingMetersToTarget: 900 })).toBe(
      false,
    );
  });
});

describe('distanceToTargetMeters', () => {
  it('returns null without a position or target', () => {
    expect(distanceToTargetMeters(null, { lat: 1, lng: 2 })).toBeNull();
    expect(distanceToTargetMeters([0, 0], null)).toBeNull();
  });

  it('measures a short distance approximately', () => {
    const d = distanceToTargetMeters([-74.0, 40.7], { lat: 40.7, lng: -74.0 });
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(1);
  });
});

describe('targetForLeg', () => {
  const waypoints = [{ lat: 1, lng: 1 }];
  const destination = { lat: 2, lng: 2 };

  it('targets the waypoint while legs remain', () => {
    expect(targetForLeg(waypoints, destination, 0)).toBe(waypoints[0]);
  });

  it('targets the destination on the final leg', () => {
    expect(targetForLeg(waypoints, destination, 1)).toBe(destination);
  });

  it('returns null when there is no destination', () => {
    expect(targetForLeg([], null, 0)).toBeNull();
  });
});
