import { normalizeTomTomResponse } from '../../src/services/traffic/tomtomFetcher';
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
