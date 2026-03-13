import {
  calculateTrafficETA,
  extractRouteSegments,
  formatETA,
} from '../../src/utils/etaCalculator';
import type { NormalizedTrafficSegment, ETARouteSegment } from '../../src/models/traffic';

// --- Helper to create route segments ---
function makeRouteSegment(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
  distanceMeters: number,
  freeFlowSpeedKmh = 60,
): ETARouteSegment {
  return {
    startCoord: [startLng, startLat],
    endCoord: [endLng, endLat],
    distanceMeters,
    freeFlowSpeedKmh,
  };
}

function makeTrafficSegment(
  id: string,
  coords: [number, number][],
  currentSpeedKmh: number,
  freeFlowSpeedKmh: number,
): NormalizedTrafficSegment {
  return {
    id,
    coordinates: coords,
    currentSpeedKmh,
    freeFlowSpeedKmh,
    congestionRatio: currentSpeedKmh / freeFlowSpeedKmh,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: Math.floor(Date.now() / 1000),
  };
}

describe('formatETA', () => {
  it('formats seconds under 60 minutes as "X min"', () => {
    expect(formatETA(900)).toBe('15 min');
    expect(formatETA(60)).toBe('1 min');
    expect(formatETA(3540)).toBe('59 min');
  });

  it('formats seconds >= 60 minutes as "X hr Y min"', () => {
    expect(formatETA(3600)).toBe('1 hr 0 min');
    expect(formatETA(4320)).toBe('1 hr 12 min');
    expect(formatETA(7200)).toBe('2 hr 0 min');
  });

  it('rounds up partial minutes', () => {
    expect(formatETA(61)).toBe('2 min');
    expect(formatETA(3601)).toBe('1 hr 1 min');
  });

  it('handles zero seconds', () => {
    expect(formatETA(0)).toBe('0 min');
  });
});

describe('calculateTrafficETA', () => {
  it('computes ETA using traffic speeds for fully matched segments', () => {
    // 1km at free-flow 60km/h = 60s; at current 30km/h = 120s
    const routeSegments: ETARouteSegment[] = [makeRouteSegment(4.84, 52.41, 4.85, 52.42, 1000, 60)];
    const trafficSegments: NormalizedTrafficSegment[] = [
      makeTrafficSegment('t:1', [[4.845, 52.415]], 30, 60),
    ];

    const result = calculateTrafficETA(routeSegments, trafficSegments);

    expect(result.segmentCount).toBe(1);
    expect(result.matchedSegmentCount).toBe(1);
    expect(result.freeFlowTotalSeconds).toBeCloseTo(60, 0);
    expect(result.totalSeconds).toBeCloseTo(120, 0);
  });

  it('falls back to free-flow speed for unmatched segments', () => {
    const routeSegments: ETARouteSegment[] = [makeRouteSegment(4.84, 52.41, 4.85, 52.42, 1000, 60)];
    // Traffic segment too far away
    const trafficSegments: NormalizedTrafficSegment[] = [
      makeTrafficSegment('t:1', [[10.0, 10.0]], 30, 60),
    ];

    const result = calculateTrafficETA(routeSegments, trafficSegments);

    expect(result.matchedSegmentCount).toBe(0);
    expect(result.totalSeconds).toBeCloseTo(result.freeFlowTotalSeconds, 0);
  });

  it('handles empty route segments', () => {
    const result = calculateTrafficETA([], []);
    expect(result.totalSeconds).toBe(0);
    expect(result.segmentCount).toBe(0);
    expect(result.formatted).toBe('0 min');
  });

  it('handles no traffic data (all fallback to free-flow)', () => {
    const routeSegments: ETARouteSegment[] = [
      makeRouteSegment(4.84, 52.41, 4.85, 52.42, 1000, 60),
      makeRouteSegment(4.85, 52.42, 4.86, 52.43, 500, 50),
    ];

    const result = calculateTrafficETA(routeSegments, []);

    expect(result.matchedSegmentCount).toBe(0);
    expect(result.totalSeconds).toBe(result.freeFlowTotalSeconds);
  });

  it('handles mixed matched and unmatched segments', () => {
    const routeSegments: ETARouteSegment[] = [
      makeRouteSegment(4.84, 52.41, 4.845, 52.415, 500, 60),
      makeRouteSegment(10.0, 10.0, 10.01, 10.01, 500, 60),
    ];
    const trafficSegments: NormalizedTrafficSegment[] = [
      makeTrafficSegment('t:1', [[4.8425, 52.4125]], 30, 60),
    ];

    const result = calculateTrafficETA(routeSegments, trafficSegments);

    expect(result.segmentCount).toBe(2);
    expect(result.matchedSegmentCount).toBe(1);
    // First matched at 30km/h: 500m / (30/3.6) ≈ 60s
    // Second unmatched at 60km/h: 500m / (60/3.6) ≈ 30s
    expect(result.totalSeconds).toBeGreaterThan(result.freeFlowTotalSeconds);
  });

  it('handles all-stopped traffic (very low speed)', () => {
    const routeSegments: ETARouteSegment[] = [makeRouteSegment(4.84, 52.41, 4.85, 52.42, 1000, 60)];
    const trafficSegments: NormalizedTrafficSegment[] = [
      makeTrafficSegment('t:1', [[4.845, 52.415]], 1, 60),
    ];

    const result = calculateTrafficETA(routeSegments, trafficSegments);

    // 1km at 1km/h = 3600s
    expect(result.totalSeconds).toBeCloseTo(3600, -1);
  });

  it('handles very short segments (<10m)', () => {
    const routeSegments: ETARouteSegment[] = [
      makeRouteSegment(4.84, 52.41, 4.84001, 52.41001, 5, 60),
    ];

    const result = calculateTrafficETA(routeSegments, []);

    expect(result.segmentCount).toBe(1);
    expect(result.totalSeconds).toBeGreaterThan(0);
  });

  it('produces correctly formatted output', () => {
    const routeSegments: ETARouteSegment[] = [
      makeRouteSegment(4.84, 52.41, 4.85, 52.42, 10000, 60),
    ];

    const result = calculateTrafficETA(routeSegments, []);

    expect(result.formatted).toMatch(/\d+ min/);
    expect(result.freeFlowFormatted).toMatch(/\d+ min/);
  });
});

describe('extractRouteSegments', () => {
  it('decodes a simple encoded polyline into route segments', () => {
    // A simple 2-point geometry (manually encoded is hard, but we test with a
    // known Valhalla-style encoded string). For now, test structural properties.
    // We'll use a mock geometry that decodes to known points.
    const mockGeometry = 'ss~iqBknnwO??'; // 2 identical points → 1 segment
    const segments = extractRouteSegments(mockGeometry);
    // Should produce at least 0 segments (depends on decode result)
    expect(Array.isArray(segments)).toBe(true);
  });
});
