import { normalizeHEREResponse } from '../../src/services/traffic/hereFetcher';

describe('normalizeHEREResponse', () => {
  const validResult = {
    location: {
      shape: {
        links: [
          {
            points: [
              { lat: 40.7128, lng: -74.006 },
              { lat: 40.7138, lng: -74.005 },
              { lat: 40.7148, lng: -74.004 },
            ],
            length: 200,
          },
        ],
      },
    },
    currentFlow: {
      speed: 35,
      freeFlow: 50,
      jamFactor: 3.5,
      confidence: 0.92,
    },
  };

  it('normalizes a valid HERE result into NormalizedTrafficSegments', () => {
    const segments = normalizeHEREResponse(validResult);
    expect(segments).toHaveLength(1);
    expect(segments[0].source).toBe('here');
    expect(segments[0].currentSpeedKmh).toBe(35);
    expect(segments[0].freeFlowSpeedKmh).toBe(50);
    expect(segments[0].congestionRatio).toBeCloseTo(0.7);
    expect(segments[0].confidence).toBe(0.92);
    expect(segments[0].coordinates).toHaveLength(3);
    expect(segments[0].id).toMatch(/^here:/);
  });

  it('assigns default confidence of 0.85 when missing', () => {
    const result = {
      ...validResult,
      currentFlow: { ...validResult.currentFlow, confidence: undefined as any },
    };
    const segments = normalizeHEREResponse(result);
    expect(segments[0].confidence).toBe(0.85);
  });

  it('returns empty array for link with < 2 points', () => {
    const result = {
      location: {
        shape: {
          links: [{ points: [{ lat: 40.7128, lng: -74.006 }], length: 100 }],
        },
      },
      currentFlow: { speed: 35, freeFlow: 50, jamFactor: 3.5, confidence: 0.9 },
    };
    const segments = normalizeHEREResponse(result);
    expect(segments).toHaveLength(0);
  });

  it('returns empty array when freeFlow speed is 0', () => {
    const result = {
      ...validResult,
      currentFlow: { ...validResult.currentFlow, freeFlow: 0 },
    };
    const segments = normalizeHEREResponse(result);
    expect(segments).toHaveLength(0);
  });

  it('clamps congestion ratio to [0, 1]', () => {
    const result = {
      ...validResult,
      currentFlow: { ...validResult.currentFlow, speed: 60, freeFlow: 50 },
    };
    const segments = normalizeHEREResponse(result);
    expect(segments[0].congestionRatio).toBe(1);
  });

  it('handles multiple links', () => {
    const result = {
      location: {
        shape: {
          links: [
            {
              points: [
                { lat: 40.71, lng: -74.0 },
                { lat: 40.72, lng: -74.01 },
              ],
              length: 150,
            },
            {
              points: [
                { lat: 40.73, lng: -74.02 },
                { lat: 40.74, lng: -74.03 },
              ],
              length: 150,
            },
          ],
        },
      },
      currentFlow: { speed: 30, freeFlow: 60, jamFactor: 5, confidence: 0.8 },
    };
    const segments = normalizeHEREResponse(result);
    expect(segments).toHaveLength(2);
    expect(segments[0].id).not.toBe(segments[1].id);
  });
});
