import {
  congestionColor,
  buildRouteTrafficGeoJSON,
  DEFAULT_ROUTE_COLOR,
} from '../../src/services/traffic/routeTrafficService';
import type { NormalizedTrafficSegment } from '../../src/models/traffic';

// ---------------------------------------------------------------------------
// congestionColor
// ---------------------------------------------------------------------------
describe('congestionColor', () => {
  it('returns green for free-flow (ratio >= 0.75)', () => {
    expect(congestionColor(0.75)).toBe('#00C853');
    expect(congestionColor(1.0)).toBe('#00C853');
  });

  it('returns yellow for slow traffic (0.50 – 0.74)', () => {
    expect(congestionColor(0.5)).toBe('#FFD600');
    expect(congestionColor(0.74)).toBe('#FFD600');
  });

  it('returns orange for congested (0.25 – 0.49)', () => {
    expect(congestionColor(0.25)).toBe('#FF6D00');
    expect(congestionColor(0.49)).toBe('#FF6D00');
  });

  it('returns dark red for stopped (< 0.25)', () => {
    expect(congestionColor(0.0)).toBe('#D50000');
    expect(congestionColor(0.24)).toBe('#D50000');
  });
});

// ---------------------------------------------------------------------------
// buildRouteTrafficGeoJSON
// ---------------------------------------------------------------------------
function makeSeg(
  overrides: Partial<NormalizedTrafficSegment> &
    Pick<NormalizedTrafficSegment, 'coordinates' | 'congestionRatio'>,
): NormalizedTrafficSegment {
  return {
    id: 'seg-1',
    currentSpeedMph: 40,
    freeFlowSpeedMph: 60,
    confidence: 0.9,
    source: 'tomtom',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('buildRouteTrafficGeoJSON', () => {
  it('returns empty features for fewer than 2 route coords', () => {
    const result = buildRouteTrafficGeoJSON([[0, 0]], []);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('returns default blue when no traffic segments provided', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.07, 42.37],
    ];
    const result = buildRouteTrafficGeoJSON(route, []);
    expect(result.features.length).toBeGreaterThanOrEqual(1);
    expect(result.features.every((f) => f.properties.color === DEFAULT_ROUTE_COLOR)).toBe(true);
  });

  it('colors a route chunk green when a nearby free-flow segment exists', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.061, 42.361],
      [-71.062, 42.362],
    ];
    const seg = makeSeg({
      coordinates: [[-71.061, 42.361]],
      congestionRatio: 0.9, // free flow
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    expect(result.features.length).toBeGreaterThanOrEqual(1);

    const colors = result.features.map((f) => f.properties.color);
    expect(colors).toContain('#00C853'); // green
  });

  it('colors a route chunk red when stopped traffic is nearby', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.061, 42.361],
      [-71.062, 42.362],
    ];
    const seg = makeSeg({
      coordinates: [[-71.061, 42.361]],
      congestionRatio: 0.1, // stopped
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    const colors = result.features.map((f) => f.properties.color);
    expect(colors).toContain('#D50000'); // dark red
  });

  it('falls back to default blue when no segment is within threshold', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.061, 42.361],
    ];
    // Segment far away (>0.001° ≈ 100 m)
    const seg = makeSeg({
      coordinates: [[-72.0, 43.0]],
      congestionRatio: 0.9,
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    expect(result.features.length).toBeGreaterThanOrEqual(1);

    const colors = result.features.map((f) => f.properties.color);
    expect(colors.every((c) => c === DEFAULT_ROUTE_COLOR)).toBe(true);
  });

  it('matches the closest segment when multiple are nearby', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.061, 42.361],
      [-71.062, 42.362],
    ];
    // Close segment (slow)
    const close = makeSeg({
      id: 'close',
      coordinates: [[-71.061, 42.361]],
      congestionRatio: 0.6, // slow → yellow
    });
    // Slightly farther segment (free flow) — still within threshold but farther
    const far = makeSeg({
      id: 'far',
      coordinates: [[-71.0615, 42.3615]],
      congestionRatio: 0.95, // free flow → green
    });

    const result = buildRouteTrafficGeoJSON(route, [close, far]);
    const colors = result.features.map((f) => f.properties.color);
    // The closer segment (slow/yellow) should win
    expect(colors).toContain('#FFD600');
  });

  it('produces valid GeoJSON with correct structure', () => {
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.065, 42.365],
      [-71.07, 42.37],
      [-71.075, 42.375],
    ];
    const seg = makeSeg({
      coordinates: [[-71.065, 42.365]],
      congestionRatio: 0.4,
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    expect(result.type).toBe('FeatureCollection');
    for (const feature of result.features) {
      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('LineString');
      expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
      expect(typeof feature.properties.color).toBe('string');
    }
  });
});
