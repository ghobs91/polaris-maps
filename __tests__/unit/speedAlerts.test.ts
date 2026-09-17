import { OverSpeedMonitor, speedLimitChanged } from '../../src/services/navigation/speedAlerts';

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
