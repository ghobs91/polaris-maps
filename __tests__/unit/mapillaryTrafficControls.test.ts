jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: 'test-token',
}));

import {
  bboxAround,
  cellsForCoordinates,
  controlsNearPath,
  fetchTrafficControlsAlongRoute,
  getTrafficControlStateAt,
  isTrafficControlDataAvailable,
  normalizeTrafficControls,
  resetTrafficControlCachesForTests,
  trafficControlKind,
  TRAFFIC_CONTROL_MATCH_RADIUS_METERS,
  type TrafficControl,
} from '../../src/services/imagery/mapillaryTrafficControls';

const mockFetch = jest.fn();
const mockConfig = jest.requireMock('../../src/constants/config') as { MAPILLARY_TOKEN: string };

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function feature(id: string, objectValue: string, lng: number, lat: number) {
  return { id, object_value: objectValue, geometry: { type: 'Point', coordinates: [lng, lat] } };
}

const STOP_SIGN = 'regulatory--stop--g1';
const TRAFFIC_LIGHT = 'object--traffic-light--general-upright';

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.MAPILLARY_TOKEN = 'test-token';
  resetTrafficControlCachesForTests();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('trafficControlKind', () => {
  it('recognises every regional stop-sign and traffic-light variant', () => {
    expect(trafficControlKind('regulatory--stop--g1')).toBe('stop-sign');
    expect(trafficControlKind('regulatory--stop--g10')).toBe('stop-sign');
    expect(trafficControlKind('object--traffic-light--general-single')).toBe('traffic-light');
    expect(trafficControlKind('object--traffic-light--pedestrians')).toBe('traffic-light');
  });

  it('ignores unrelated detections', () => {
    expect(trafficControlKind('regulatory--yield--g1')).toBeNull();
    expect(trafficControlKind('object--bench')).toBeNull();
    expect(trafficControlKind('')).toBeNull();
  });
});

describe('normalizeTrafficControls', () => {
  it('maps map features into controls and drops malformed or duplicate entries', () => {
    const controls = normalizeTrafficControls({
      data: [
        feature('1', STOP_SIGN, -74.001, 40.7),
        feature('2', TRAFFIC_LIGHT, -74.002, 40.701),
        feature('2', TRAFFIC_LIGHT, -74.002, 40.701),
        feature('3', 'regulatory--yield--g1', -74.003, 40.702),
        { id: '4', object_value: STOP_SIGN },
        { id: '5', object_value: STOP_SIGN, geometry: { type: 'Point', coordinates: ['x', 1] } },
      ],
    });

    expect(controls).toEqual([
      { id: '1', kind: 'stop-sign', lat: 40.7, lng: -74.001, objectValue: STOP_SIGN },
      { id: '2', kind: 'traffic-light', lat: 40.701, lng: -74.002, objectValue: TRAFFIC_LIGHT },
    ]);
  });

  it('returns an empty list for an unexpected payload', () => {
    expect(normalizeTrafficControls(null)).toEqual([]);
    expect(normalizeTrafficControls({ data: 'nope' })).toEqual([]);
  });
});

describe('cellsForCoordinates', () => {
  it('dedupes cells and keeps travel order', () => {
    const cells = cellsForCoordinates([
      [-74.001, 40.701],
      [-74.0095, 40.7095],
      [-74.011, 40.711],
    ]);

    expect(cells).toHaveLength(2);
    expect(cells[0].bbox[0]).toBeCloseTo(-74.01, 6);
    expect(cells[0].bbox[1]).toBeCloseTo(40.7, 6);
    expect(cells[1].bbox[0]).toBeCloseTo(-74.02, 6);
    expect(cells[1].bbox[1]).toBeCloseTo(40.71, 6);
  });

  it('caps the number of cells', () => {
    const coords = Array.from({ length: 80 }, (_, index) => [index * 0.01, 40] as [number, number]);
    expect(cellsForCoordinates(coords, 5)).toHaveLength(5);
  });
});

describe('bboxAround', () => {
  it('returns Mapillary order [minLng, minLat, maxLng, maxLat]', () => {
    const bbox = bboxAround(40, -74, 100);
    expect(bbox[0]).toBeLessThan(-74);
    expect(bbox[1]).toBeLessThan(40);
    expect(bbox[2]).toBeGreaterThan(-74);
    expect(bbox[3]).toBeGreaterThan(40);
  });
});

describe('fetchTrafficControlsAlongRoute', () => {
  it('queries both control classes, merges cells and caches responses', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/map_features')) {
        return Promise.resolve(
          jsonResponse({
            data: [
              feature('1', STOP_SIGN, -74.001, 40.701),
              feature('2', TRAFFIC_LIGHT, -74.0015, 40.7015),
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const coords: [number, number][] = [
      [-74.001, 40.701],
      [-74.002, 40.702],
    ];
    const first = await fetchTrafficControlsAlongRoute(coords);
    expect(first.map((control) => control.id).sort()).toEqual(['1', '2']);

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('object_values=');
    expect(decodeURIComponent(url)).toContain('regulatory--stop--*');
    expect(decodeURIComponent(url)).toContain('object--traffic-light--*');

    const callsAfterFirst = mockFetch.mock.calls.length;
    const second = await fetchTrafficControlsAlongRoute(coords);
    expect(second.map((control) => control.id).sort()).toEqual(['1', '2']);
    expect(mockFetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('returns nothing without a token', async () => {
    mockConfig.MAPILLARY_TOKEN = '';
    expect(isTrafficControlDataAvailable()).toBe(false);
    await expect(fetchTrafficControlsAlongRoute([[-74, 40]])).resolves.toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('getTrafficControlStateAt', () => {
  it('reports coverage and controls near the point', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/images')) return Promise.resolve(jsonResponse({ data: [{ id: 'img' }] }));
      return Promise.resolve(jsonResponse({ data: [feature('1', TRAFFIC_LIGHT, -74.0002, 40)] }));
    });

    const state = await getTrafficControlStateAt(40, -74);
    expect(state).not.toBeNull();
    expect(state?.hasCoverage).toBe(true);
    expect(state?.controls.map((control) => control.id)).toEqual(['1']);
  });

  it('drops controls outside the association radius', async () => {
    const farLng = -74 + 0.001; // ~85 m away
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/images')) return Promise.resolve(jsonResponse({ data: [{ id: 'img' }] }));
      return Promise.resolve(jsonResponse({ data: [feature('1', STOP_SIGN, farLng, 40)] }));
    });

    const state = await getTrafficControlStateAt(40, -74);
    expect(state?.controls).toEqual([]);
  });

  it('reports no coverage when Mapillary has no imagery there', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/images')) return Promise.resolve(jsonResponse({ data: [] }));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const state = await getTrafficControlStateAt(40, -74);
    expect(state).toEqual({ lat: 40, lng: -74, hasCoverage: false, controls: [] });
  });

  it('returns null when a request fails so callers can treat it as unknown', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/images')) return Promise.resolve(jsonResponse({ error: true }, false));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    await expect(getTrafficControlStateAt(40, -74)).resolves.toBeNull();
    // A failure is not cached: the next call retries.
    const calls = mockFetch.mock.calls.length;
    await getTrafficControlStateAt(40, -74);
    expect(mockFetch.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('controlsNearPath', () => {
  const coords: [number, number][] = [
    [-74.0, 40.7],
    [-74.01, 40.7],
  ];

  it('keeps controls on the driven line and drops parallel-street ones', () => {
    const onRoute: TrafficControl = {
      id: 'on',
      kind: 'stop-sign',
      lng: -74.005,
      lat: 40.7,
      objectValue: STOP_SIGN,
    };
    const parallel: TrafficControl = {
      id: 'off',
      kind: 'traffic-light',
      lng: -74.005,
      lat: 40.7008, // ~90 m north
      objectValue: TRAFFIC_LIGHT,
    };

    expect(controlsNearPath([onRoute, parallel], coords).map((control) => control.id)).toEqual([
      'on',
    ]);
  });

  it('uses the documented association radius', () => {
    expect(TRAFFIC_CONTROL_MATCH_RADIUS_METERS).toBe(45);
  });
});
