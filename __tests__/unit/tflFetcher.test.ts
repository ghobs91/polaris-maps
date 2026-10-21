import {
  fetchTflLines,
  clearTflCache,
  parseTflLineString,
} from '../../src/services/transit/tflFetcher';

describe('parseTflLineString', () => {
  it('keeps branch polylines as separate segments', () => {
    const raw = JSON.stringify([
      [
        [-0.19, 51.4],
        [-0.18, 51.42],
      ],
      [
        [-0.14, 51.48],
        [-0.13, 51.5],
      ],
    ]);

    expect(parseTflLineString(raw)).toEqual([
      [
        [-0.19, 51.4],
        [-0.18, 51.42],
      ],
      [
        [-0.14, 51.48],
        [-0.13, 51.5],
      ],
    ]);
  });

  it('parses a single flat polyline without swapping coordinates', () => {
    const raw = JSON.stringify([
      [-0.114888, 51.462618],
      [-0.122644, 51.472184],
    ]);

    expect(parseTflLineString(raw)).toEqual([
      [
        [-0.114888, 51.462618],
        [-0.122644, 51.472184],
      ],
    ]);
  });

  it('returns no segments for malformed input', () => {
    expect(parseTflLineString('not json')).toEqual([]);
    expect(parseTflLineString('[]')).toEqual([]);
  });
});

describe('tflFetcher', () => {
  const mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  beforeEach(() => {
    mockFetch.mockReset();
    clearTflCache();
  });

  const emptyModeResponse = () => ({ ok: true, json: async () => [] });

  it('handles API errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await fetchTflLines();
    expect(result).toEqual([]);
  });

  it('caches result when all modes return empty', async () => {
    mockFetch.mockResolvedValue(emptyModeResponse());

    const first = await fetchTflLines();
    expect(first).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(5);

    const second = await fetchTflLines();
    expect(second).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(5); // from cache
  });

  it('fetches lines for all rail modes and returns TransitRouteLine[]', async () => {
    const tubeLine = {
      id: 'bakerloo',
      name: 'Bakerloo',
      modeName: 'tube',
      lineStatuses: [{ statusSeverity: 10 }],
    };
    const dlrLine = {
      id: 'dlr',
      name: 'DLR',
      modeName: 'dlr',
      lineStatuses: [{ statusSeverity: 10 }],
    };

    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      // First 5 calls are mode endpoint calls (tube, dlr, overground, elizabeth-line, tram)
      if (callCount <= 5) {
        const idx = callCount;
        if (idx === 1)
          return Promise.resolve({ ok: true, json: () => Promise.resolve([tubeLine]) });
        if (idx === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve([dlrLine]) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }

      // Subsequent calls are route/stop-point calls in order: bakerloo route, bakerloo stops, dlr route, dlr stops
      if (callCount === 6) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ lineStrings: ['[[51.5,-0.1],[51.51,-0.09],[51.52,-0.08]]'] }),
        });
      }
      if (callCount === 7) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: '1', commonName: 'Station A', lat: 51.5, lon: -0.1 },
              { id: '2', commonName: 'Station B', lat: 51.52, lon: -0.08 },
            ]),
        });
      }
      if (callCount === 8) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ lineStrings: ['[[51.48,-0.05],[51.49,-0.04]]'] }),
        });
      }
      if (callCount === 9) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: '3', commonName: 'Station C', lat: 51.48, lon: -0.05 },
              { id: '4', commonName: 'Station D', lat: 51.49, lon: -0.04 },
            ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    const result = await fetchTflLines();
    expect(result.length).toBe(2);
    expect(result[0].mode).toBe('SUBWAY'); // tube
    expect(result[1].mode).toBe('TRAM'); // dlr
    expect(result[0].stops.length).toBe(2);
  });
});
