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
    // Segment far away (>0.003° ≈ 300 m)
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

  it('merges consecutive same-color segments into fewer features', () => {
    // 5 coordinate pairs, all within threshold of the same segment
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.0601, 42.3601],
      [-71.0602, 42.3602],
      [-71.0603, 42.3603],
      [-71.0604, 42.3604],
    ];
    const seg = makeSeg({
      coordinates: [[-71.0602, 42.3602]],
      congestionRatio: 0.9, // green
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    // All pairs should be green → merged into 1 feature
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.color).toBe('#00C853');
    // Merged feature should contain all 5 coordinates
    expect(result.features[0].geometry.coordinates).toHaveLength(5);
  });

  it('colors every coordinate pair, not just sampled chunks', () => {
    // Create a long route with a segment matching only near index 50
    const route: [number, number][] = [];
    for (let i = 0; i < 100; i++) {
      route.push([-71.06 + i * 0.0001, 42.36 + i * 0.0001]);
    }
    // Segment near index 50: midpoint of pair [49]-[50] ≈ (-71.0551, 42.3651)
    const seg = makeSeg({
      coordinates: [[-71.0551, 42.3651]],
      congestionRatio: 0.1, // stopped → red
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    const colors = result.features.map((f) => f.properties.color);
    // Should have the red color for pairs near the segment
    expect(colors).toContain('#D50000');
    // Should still have default blue for pairs far away
    expect(colors).toContain(DEFAULT_ROUTE_COLOR);
  });

  it('colors route segments when traffic data comes from route-aligned sampling', () => {
    // Simulate a route from point A → B with traffic segments sampled along the path.
    // This mirrors the real flow: sampleRoutePoints → TomTom API → buildRouteTrafficGeoJSON.
    const route: [number, number][] = [];
    for (let i = 0; i < 50; i++) {
      route.push([-74.0 + i * 0.002, 40.7 + i * 0.001]);
    }

    // Traffic segments at route-aligned positions — coordinates must be within
    // MATCH_THRESHOLD_DEG = 0.003 of the midpoint between consecutive route pairs.
    // Midpoint of pair [i,i+1] = [-74.0 + (i+0.5)*0.002, 40.7 + (i+0.5)*0.001]
    const segments = [
      makeSeg({
        id: 'route-seg-1',
        coordinates: [
          [-73.999, 40.7005], // midpoint of pair 0 exactly
        ],
        congestionRatio: 0.9, // free flow → green
      }),
      makeSeg({
        id: 'route-seg-2',
        coordinates: [
          [-73.959, 40.7205], // midpoint of pair 20 exactly
        ],
        congestionRatio: 0.15, // stopped → red
      }),
      makeSeg({
        id: 'route-seg-3',
        coordinates: [
          [-73.919, 40.7405], // midpoint of pair 40 exactly
        ],
        congestionRatio: 0.6, // slow → yellow
      }),
    ];

    const result = buildRouteTrafficGeoJSON(route, segments);
    const colors = result.features.map((f) => f.properties.color);
    // Should have multiple colors — not all blue
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBeGreaterThan(1);
    // Should contain traffic colors from the matched segments
    expect(colors).toContain('#00C853'); // green from seg-1
    expect(colors).toContain('#D50000'); // red from seg-2
  });

  it('matches via point-to-line-segment distance for sparse TomTom polylines', () => {
    // Route runs along a path; the TomTom segment has only 2 endpoints but the
    // route midpoint falls between them (on the line segment, not near either point).
    const route: [number, number][] = [
      [-71.06, 42.36],
      [-71.061, 42.361],
      [-71.062, 42.362],
      [-71.063, 42.363],
    ];
    // Sparse segment: 2 endpoints spanning the route — midpoints of route pairs
    // are far from both endpoints but close to the line connecting them.
    const seg = makeSeg({
      coordinates: [
        [-71.058, 42.358], // before route start
        [-71.066, 42.366], // after route end
      ],
      congestionRatio: 0.3, // congested → orange
    });

    const result = buildRouteTrafficGeoJSON(route, [seg]);
    const colors = result.features.map((f) => f.properties.color);
    // Should match via line-segment projection, not just endpoint proximity
    expect(colors).toContain('#FF6D00'); // orange
  });
});
