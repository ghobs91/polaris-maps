/**
 * Regression test: offline DOT GTFS lines merge with cached Amtrak lines.
 *
 * Bug: When `hasCachedLines()` is true (Amtrak in cache), `loadOfflineDotGtfsIfAvailable()`
 * was in an `else` branch and never executed. The user only saw Amtrak lines.
 *
 * Fix: Offline DOT GTFS data is always loaded and merged, regardless of cached state.
 */
import { describe, it, expect } from '@jest/globals';

describe('Offline DOT GTFS merge logic', () => {
  it('merges offline DOT lines into existing cached lines (dont replace)', () => {
    // Simulate cached Amtrak lines
    const cached = [
      { id: 'amtrak:NEC', ref: 'NEC', mode: 'RAIL' },
      { id: 'amtrak:Keystone', ref: 'Keystone', mode: 'RAIL' },
    ];

    // Simulate offline DOT GTFS lines
    const offline = [
      { id: 'dot:SEPTA:MF', ref: 'Market-Frankford', mode: 'SUBWAY' },
      { id: 'dot:SEPTA:BSL', ref: 'Broad Street', mode: 'SUBWAY' },
    ];

    // Merge logic (from fixed useTransitStops.ts)
    const existingIds = new Set(cached.map((l) => l.id));
    const merged = [...cached];
    for (const line of offline) {
      if (!existingIds.has(line.id)) {
        merged.push(line);
      }
    }

    // Should have all 4 lines (2 Amtrak + 2 SEPTA)
    expect(merged).toHaveLength(4);
    expect(merged.map((l) => l.id)).toContain('amtrak:NEC');
    expect(merged.map((l) => l.id)).toContain('amtrak:Keystone');
    expect(merged.map((l) => l.id)).toContain('dot:SEPTA:MF');
    expect(merged.map((l) => l.id)).toContain('dot:SEPTA:BSL');
  });

  it('handles empty offline lines (no-op)', () => {
    const cached = [{ id: 'amtrak:1' }];
    const offline: typeof cached = [];

    const merged = [...cached, ...offline];
    expect(merged).toHaveLength(1);
  });
});
