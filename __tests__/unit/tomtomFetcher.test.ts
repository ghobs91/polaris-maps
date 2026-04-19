import {
  normalizeTomTomResponse,
  sampleRoutePoints,
} from '../../src/services/traffic/tomtomFetcher';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

const FIXTURE_RESPONSE = {
  flowSegmentData: {
    frc: 'FRC2',
    currentSpeed: 45,
    freeFlowSpeed: 60,
    currentTravelTime: 120,
    freeFlowTravelTime: 90,
    confidence: 0.95,
    coordinates: {
      coordinate: [
        { latitude: 52.41072, longitude: 4.84239 },
        { latitude: 52.41073, longitude: 4.84241 },
        { latitude: 52.4108, longitude: 4.8425 },
      ],
    },
  },
};

describe('normalizeTomTomResponse', () => {
  it('normalizes a valid TomTom response to NormalizedTrafficSegment', () => {
    const result = normalizeTomTomResponse(FIXTURE_RESPONSE);

    expect(result).not.toBeNull();
    const seg = result as NormalizedTrafficSegment;
    expect(seg.source).toBe('tomtom');
    expect(seg.currentSpeedMph).toBe(45);
    expect(seg.freeFlowSpeedMph).toBe(60);
    expect(seg.congestionRatio).toBeCloseTo(0.75, 2);
    expect(seg.confidence).toBe(0.95);
    expect(seg.coordinates).toHaveLength(3);
    // Coordinates should be [lng, lat]
    expect(seg.coordinates[0]).toEqual([4.84239, 52.41072]);
    expect(seg.id).toMatch(/^tomtom:/);
    expect(seg.timestamp).toBeGreaterThan(0);
  });

  it('uses default confidence of 0.9 when confidence is missing', () => {
    const response = {
      flowSegmentData: {
        ...FIXTURE_RESPONSE.flowSegmentData,
        confidence: undefined as unknown as number,
      },
    };
    const seg = normalizeTomTomResponse(response);
    expect(seg).not.toBeNull();
    expect(seg!.confidence).toBe(0.9);
  });

  it('clamps congestion ratio to [0, 1]', () => {
    const response = {
      flowSegmentData: {
        ...FIXTURE_RESPONSE.flowSegmentData,
        currentSpeed: 70,
        freeFlowSpeed: 60,
      },
    };
    const seg = normalizeTomTomResponse(response);
    expect(seg).not.toBeNull();
    expect(seg!.congestionRatio).toBe(1);
  });

  it('returns null for response with fewer than 2 coordinates', () => {
    const response = {
      flowSegmentData: {
        ...FIXTURE_RESPONSE.flowSegmentData,
        coordinates: {
          coordinate: [{ latitude: 52.41072, longitude: 4.84239 }],
        },
      },
    };
    expect(normalizeTomTomResponse(response)).toBeNull();
  });

  it('returns null for response with zero freeFlowSpeed', () => {
    const response = {
      flowSegmentData: {
        ...FIXTURE_RESPONSE.flowSegmentData,
        freeFlowSpeed: 0,
      },
    };
    expect(normalizeTomTomResponse(response)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sampleRoutePoints
// ---------------------------------------------------------------------------
describe('sampleRoutePoints', () => {
  it('returns empty array for empty input', () => {
    expect(sampleRoutePoints([])).toHaveLength(0);
  });

  it('returns start and end for a 2-point route', () => {
    const coords: [number, number][] = [
      [-74.0, 40.7],
      [-73.5, 40.8],
    ];
    const points = sampleRoutePoints(coords);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]).toEqual({ lng: -74.0, lat: 40.7 });
    expect(points[points.length - 1]).toEqual({ lng: -73.5, lat: 40.8 });
  });

  it('skips densely packed points within spacing threshold', () => {
    // Create 100 points very close together (~0.001° apart = ~100m)
    const coords: [number, number][] = [];
    for (let i = 0; i < 100; i++) {
      coords.push([-74.0 + i * 0.001, 40.7]);
    }
    const points = sampleRoutePoints(coords);
    // 0.001 * 100 = 0.1° total span with 0.008° spacing ≈ 13 points + endpoints
    expect(points.length).toBeLessThan(coords.length);
    expect(points.length).toBeGreaterThanOrEqual(10);
  });

  it('always includes first and last coordinate', () => {
    const coords: [number, number][] = [
      [-74.0, 40.7],
      [-74.001, 40.701],
      [-74.002, 40.702],
      [-73.5, 40.8],
    ];
    const points = sampleRoutePoints(coords);
    expect(points[0]).toEqual({ lng: -74.0, lat: 40.7 });
    expect(points[points.length - 1]).toEqual({ lng: -73.5, lat: 40.8 });
  });

  it('produces samples along a real-length route (~50km)', () => {
    // Simulate ~50km east-west route: 0.5° of longitude at lat 40.7
    const coords: [number, number][] = [];
    for (let i = 0; i <= 500; i++) {
      coords.push([-74.0 + i * 0.001, 40.7]);
    }
    const points = sampleRoutePoints(coords);
    // 0.5° span with 0.008° spacing ≈ 63 samples
    expect(points.length).toBeGreaterThanOrEqual(50);
    expect(points.length).toBeLessThanOrEqual(80);
  });
});
