import {
  OverSpeedMonitor,
  speedLimitChanged,
  isPlausibleSpeedLimitMph,
  resolveSpeedLimitMph,
} from '../../src/services/navigation/speedAlerts';
import type { ValhallaManeuver } from '../../src/models/route';

/** Minimal maneuver shape — the resolver only reads `type` and `speedLimitMph`. */
function maneuver(
  type: ValhallaManeuver['type'],
  speedLimitMph?: number,
): Pick<ValhallaManeuver, 'type' | 'speedLimitMph'> {
  return { type, speedLimitMph };
}

describe('OverSpeedMonitor', () => {
  it('does not alert within the over threshold', () => {
    const monitor = new OverSpeedMonitor();
    expect(monitor.update(63, 60)).toBe(false);
  });

  it('alerts once at or beyond the over threshold', () => {
    const monitor = new OverSpeedMonitor();
    expect(monitor.update(65, 60)).toBe(true);
    expect(monitor.update(70, 60)).toBe(true);
  });

  it('holds the alert until back within the clear threshold (hysteresis)', () => {
    const monitor = new OverSpeedMonitor();
    expect(monitor.update(66, 60)).toBe(true);
    // Below the over threshold but above the clear margin — still alerting.
    expect(monitor.update(63, 60)).toBe(true);
    // Within the clear margin — clears.
    expect(monitor.update(62, 60)).toBe(false);
  });

  it('honours custom thresholds', () => {
    const monitor = new OverSpeedMonitor();
    expect(monitor.update(66, 60, { overThresholdMph: 10, clearThresholdMph: 1 })).toBe(false);
    expect(monitor.update(71, 60, { overThresholdMph: 10, clearThresholdMph: 1 })).toBe(true);
  });

  it('clears when the limit or speed becomes unavailable', () => {
    const monitor = new OverSpeedMonitor();
    expect(monitor.update(80, 60)).toBe(true);
    expect(monitor.update(80, null)).toBe(false);
    expect(monitor.update(null, 60)).toBe(false);
    expect(monitor.update(80, 60)).toBe(true);
  });

  it('resets to the clear state', () => {
    const monitor = new OverSpeedMonitor();
    monitor.update(80, 60);
    monitor.reset();
    expect(monitor.update(63, 60)).toBe(false);
  });
});

describe('speedLimitChanged', () => {
  it('detects a change', () => {
    expect(speedLimitChanged(30, 45)).toBe(true);
    expect(speedLimitChanged(30, 30)).toBe(false);
    expect(speedLimitChanged(null, 30)).toBe(true);
    expect(speedLimitChanged(30, null)).toBe(true);
    expect(speedLimitChanged(null, null)).toBe(false);
  });
});

describe('isPlausibleSpeedLimitMph', () => {
  it('accepts real posted limits', () => {
    expect(isPlausibleSpeedLimitMph(25)).toBe(true);
    expect(isPlausibleSpeedLimitMph(65)).toBe(true);
    expect(isPlausibleSpeedLimitMph(130)).toBe(true);
  });

  it('rejects sentinels, zeros, and parse artifacts', () => {
    expect(isPlausibleSpeedLimitMph(null)).toBe(false);
    expect(isPlausibleSpeedLimitMph(undefined)).toBe(false);
    expect(isPlausibleSpeedLimitMph(0)).toBe(false);
    expect(isPlausibleSpeedLimitMph(-1)).toBe(false);
    expect(isPlausibleSpeedLimitMph(Number.NaN)).toBe(false);
    expect(isPlausibleSpeedLimitMph(Number.POSITIVE_INFINITY)).toBe(false);
    // 130 km/h misread as mph would land here.
    expect(isPlausibleSpeedLimitMph(201)).toBe(false);
  });
});

describe('resolveSpeedLimitMph', () => {
  it('returns null before any limit is known', () => {
    const route = [maneuver('start'), maneuver('turn_left'), maneuver('destination')];
    expect(resolveSpeedLimitMph(route, 0)).toBeNull();
  });

  it('reports the limit of the maneuver already reached', () => {
    const route = [maneuver('start'), maneuver('turn_left', 30), maneuver('turn_right', 45)];
    expect(resolveSpeedLimitMph(route, 1)).toBe(30);
    expect(resolveSpeedLimitMph(route, 2)).toBe(45);
  });

  it('holds the last known limit across maneuvers with no limit data', () => {
    const route = [
      maneuver('start'),
      maneuver('turn_left', 45),
      maneuver('continue'),
      maneuver('continue'),
      maneuver('turn_right', 25),
    ];
    // The untagged stretch keeps the sign up instead of blinking out.
    expect(resolveSpeedLimitMph(route, 2)).toBe(45);
    expect(resolveSpeedLimitMph(route, 3)).toBe(45);
    expect(resolveSpeedLimitMph(route, 4)).toBe(25);
  });

  it('ignores implausible limits rather than showing them', () => {
    const route = [maneuver('start', 40), maneuver('continue', 0), maneuver('turn_left', 30)];
    expect(resolveSpeedLimitMph(route, 1)).toBe(40);
    expect(resolveSpeedLimitMph(route, 2)).toBe(30);
  });

  it('does not carry a road limit onto a ferry', () => {
    const route = [
      maneuver('start', 55),
      maneuver('ferry'),
      maneuver('turn_left'),
      maneuver('continue'),
    ];
    expect(resolveSpeedLimitMph(route, 1)).toBeNull();
    // The ferry breaks the carry: the pre-boarding limit says nothing about
    // the road after landing, so it must not resurface there either.
    expect(resolveSpeedLimitMph(route, 2)).toBeNull();
    expect(resolveSpeedLimitMph(route, 3)).toBeNull();
    // A fresh limit after the crossing does show.
    expect(resolveSpeedLimitMph([...route.slice(0, 2), maneuver('turn_left', 30)], 2)).toBe(30);
  });

  it('clamps an out-of-range step index and tolerates an empty route', () => {
    const route = [maneuver('start', 35)];
    expect(resolveSpeedLimitMph(route, 99)).toBe(35);
    expect(resolveSpeedLimitMph(route, -1)).toBeNull();
    expect(resolveSpeedLimitMph([], 0)).toBeNull();
  });
});
