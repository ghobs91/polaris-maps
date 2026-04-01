import {
  computeBearing,
  computeRemainingMeters,
  haversineMeters,
  snapToRoute,
  isOffRoute,
  OFF_ROUTE_THRESHOLD_METERS,
  OFF_ROUTE_CONSECUTIVE_COUNT,
} from '../../src/utils/routeSnap';

describe('routeSnap', () => {
  describe('computeBearing', () => {
    it('returns ~0° for a point due north', () => {
      const from: [number, number] = [-74.0, 40.0];
      const to: [number, number] = [-74.0, 41.0];
      const bearing = computeBearing(from, to);
      expect(bearing).toBeCloseTo(0, 0);
    });

    it('returns ~90° for a point due east', () => {
      const from: [number, number] = [-74.0, 40.0];
      const to: [number, number] = [-73.0, 40.0];
      const bearing = computeBearing(from, to);
      expect(bearing).toBeCloseTo(90, 0);
    });

    it('returns ~180° for a point due south', () => {
      const from: [number, number] = [-74.0, 41.0];
      const to: [number, number] = [-74.0, 40.0];
      const bearing = computeBearing(from, to);
      expect(bearing).toBeCloseTo(180, 0);
    });

    it('returns ~270° for a point due west', () => {
      const from: [number, number] = [-73.0, 40.0];
      const to: [number, number] = [-74.0, 40.0];
      const bearing = computeBearing(from, to);
      expect(bearing).toBeCloseTo(270, 0);
    });
  });

  describe('haversineMeters', () => {
    it('returns 0 for identical points', () => {
      const p: [number, number] = [-74.006, 40.7128];
      expect(haversineMeters(p, p)).toBe(0);
    });

    it('returns approximately correct distance for known points', () => {
      // New York to Newark is roughly 14.5 km
      const nyc: [number, number] = [-74.006, 40.7128];
      const newark: [number, number] = [-74.1724, 40.7357];
      const dist = haversineMeters(nyc, newark);
      expect(dist).toBeGreaterThan(13_000);
      expect(dist).toBeLessThan(16_000);
    });
  });

  describe('snapToRoute', () => {
    // Simple 3-point L-shaped route: east then north
    const coords: [number, number][] = [
      [-74.0, 40.0], // start
      [-73.99, 40.0], // turn point (east)
      [-73.99, 40.01], // end (north)
    ];

    it('snaps a point near the first segment to segment 0', () => {
      // Point slightly north of the east-heading first segment
      const pos: [number, number] = [-73.995, 40.0001];
      const result = snapToRoute(pos, coords);
      expect(result.segmentIndex).toBe(0);
      // Snapped point should be on the first segment (lat ≈ 40.0)
      expect(result.snapped[1]).toBeCloseTo(40.0, 3);
    });

    it('snaps a point near the second segment to segment 1', () => {
      // Point slightly west of the north-heading second segment
      const pos: [number, number] = [-73.9901, 40.005];
      const result = snapToRoute(pos, coords);
      expect(result.segmentIndex).toBe(1);
      // Snapped point should be on the second segment (lng ≈ -73.99)
      expect(result.snapped[0]).toBeCloseTo(-73.99, 3);
    });

    it('returns the start point when GPS is at route start', () => {
      const result = snapToRoute(coords[0], coords);
      expect(result.segmentIndex).toBe(0);
      expect(result.snapped[0]).toBeCloseTo(coords[0][0], 5);
      expect(result.snapped[1]).toBeCloseTo(coords[0][1], 5);
    });

    it('returns a bearing consistent with the segment direction', () => {
      // First segment goes east → bearing should be near 90°
      const result = snapToRoute([-73.995, 40.0], coords);
      expect(result.bearing).toBeCloseTo(90, 0);
    });

    it('handles a single-segment route', () => {
      const twoPoints: [number, number][] = [
        [-74.0, 40.0],
        [-73.99, 40.0],
      ];
      const pos: [number, number] = [-73.995, 40.0001];
      const result = snapToRoute(pos, twoPoints);
      expect(result.segmentIndex).toBe(0);
    });
  });

  describe('computeRemainingMeters', () => {
    // 3-point straight eastward route: each segment ~1.1 km at 40° lat
    const coords: [number, number][] = [
      [-74.0, 40.0],
      [-73.99, 40.0],
      [-73.98, 40.0],
    ];
    const seg0Len = haversineMeters(coords[0], coords[1]);
    const seg1Len = haversineMeters(coords[1], coords[2]);
    const totalLen = seg0Len + seg1Len;

    it('returns ~total length when snapped at the very start (segmentIndex 0)', () => {
      const result = computeRemainingMeters(coords[0], 0, coords);
      // snapped = coords[0], haversine to coords[1] = seg0Len, plus seg1Len
      expect(result).toBeCloseTo(totalLen, -1); // within 10 m
    });

    it('returns ~half the total when snapped at the midpoint of segment 0', () => {
      const mid: [number, number] = [-73.995, 40.0];
      const result = computeRemainingMeters(mid, 0, coords);
      const expected = haversineMeters(mid, coords[1]) + seg1Len;
      expect(result).toBeCloseTo(expected, -1);
    });

    it('returns ~0 when snapped at the final vertex', () => {
      const last = coords[coords.length - 1];
      const result = computeRemainingMeters(last, coords.length - 2, coords);
      // last point to next (clamped to last) is 0; no further segments
      expect(result).toBeLessThan(1);
    });

    it('returns ~seg1Len when snapped at the turn point (start of segment 1)', () => {
      const result = computeRemainingMeters(coords[1], 1, coords);
      expect(result).toBeCloseTo(seg1Len, -1);
    });

    it('returns 0 for an empty coords array', () => {
      expect(computeRemainingMeters([0, 0], 0, [])).toBe(0);
    });
  });

  describe('snapToRoute distanceMeters', () => {
    const coords: [number, number][] = [
      [-74.0, 40.0],
      [-73.99, 40.0],
      [-73.98, 40.0],
    ];

    it('returns ~0 distanceMeters when GPS is exactly on the route', () => {
      const result = snapToRoute([-73.995, 40.0], coords);
      expect(result.distanceMeters).toBeLessThan(1);
    });

    it('returns a positive distanceMeters when GPS is offset from the route', () => {
      // Offset ~111m north (0.001° latitude ≈ 111m)
      const result = snapToRoute([-73.995, 40.001], coords);
      expect(result.distanceMeters).toBeGreaterThan(100);
      expect(result.distanceMeters).toBeLessThan(120);
    });

    it('returns a large distanceMeters when GPS is far from route', () => {
      // Offset ~555m north (0.005° latitude ≈ 555m)
      const result = snapToRoute([-73.995, 40.005], coords);
      expect(result.distanceMeters).toBeGreaterThan(500);
    });
  });

  describe('isOffRoute', () => {
    it('returns false when distance is below threshold', () => {
      expect(isOffRoute(OFF_ROUTE_THRESHOLD_METERS - 1, OFF_ROUTE_CONSECUTIVE_COUNT)).toBe(false);
    });

    it('returns false when distance exceeds threshold but count is too low', () => {
      expect(isOffRoute(OFF_ROUTE_THRESHOLD_METERS + 10, OFF_ROUTE_CONSECUTIVE_COUNT - 1)).toBe(
        false,
      );
    });

    it('returns true when distance exceeds threshold and count meets minimum', () => {
      expect(isOffRoute(OFF_ROUTE_THRESHOLD_METERS + 10, OFF_ROUTE_CONSECUTIVE_COUNT)).toBe(true);
    });

    it('returns true when distance and count both well above thresholds', () => {
      expect(isOffRoute(200, 10)).toBe(true);
    });

    it('returns false when distance is exactly the threshold', () => {
      // Must be strictly greater than threshold
      expect(isOffRoute(OFF_ROUTE_THRESHOLD_METERS, OFF_ROUTE_CONSECUTIVE_COUNT)).toBe(false);
    });

    it('returns false when count is 0', () => {
      expect(isOffRoute(100, 0)).toBe(false);
    });
  });
});
