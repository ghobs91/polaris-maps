import { calculateTrafficETA } from '../../src/utils/etaCalculator';
import type { ETARouteSegment, NormalizedTrafficSegment } from '../../src/models/traffic';

function makeLargeRouteSegments(count: number): ETARouteSegment[] {
  const segments: ETARouteSegment[] = [];
  let lng = 4.84;
  let lat = 52.41;
  for (let i = 0; i < count; i++) {
    const nextLng = lng + 0.001;
    const nextLat = lat + 0.0005;
    segments.push({
      startCoord: [lng, lat],
      endCoord: [nextLng, nextLat],
      distanceMeters: 100,
      freeFlowSpeedKmh: 60,
    });
    lng = nextLng;
    lat = nextLat;
  }
  return segments;
}

function makeLargeTrafficSegments(count: number): NormalizedTrafficSegment[] {
  const segments: NormalizedTrafficSegment[] = [];
  let lng = 4.84;
  let lat = 52.41;
  for (let i = 0; i < count; i++) {
    const nextLng = lng + 0.001;
    const nextLat = lat + 0.0005;
    segments.push({
      id: `bench:${i}`,
      coordinates: [
        [lng, lat],
        [nextLng, nextLat],
      ],
      currentSpeedKmh: 30 + Math.random() * 30,
      freeFlowSpeedKmh: 60,
      congestionRatio: 0.5 + Math.random() * 0.5,
      confidence: 0.9,
      source: 'tomtom',
      timestamp: Math.floor(Date.now() / 1000),
    });
    lng = nextLng;
    lat = nextLat;
  }
  return segments;
}

describe('calculateTrafficETA benchmark', () => {
  it('computes ETA for 1000 route segments within 50ms', () => {
    const routeSegments = makeLargeRouteSegments(1000);
    const trafficSegments = makeLargeTrafficSegments(200);

    const start = performance.now();
    const result = calculateTrafficETA(routeSegments, trafficSegments);
    const elapsed = performance.now() - start;

    expect(result.segmentCount).toBe(1000);
    expect(result.totalSeconds).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('computes ETA for 5000 route segments within 200ms', () => {
    const routeSegments = makeLargeRouteSegments(5000);
    const trafficSegments = makeLargeTrafficSegments(500);

    const start = performance.now();
    const result = calculateTrafficETA(routeSegments, trafficSegments);
    const elapsed = performance.now() - start;

    expect(result.segmentCount).toBe(5000);
    expect(result.totalSeconds).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});
