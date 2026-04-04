import { fetchAmtrakRoutes, clearAmtrakCache } from '../../src/services/transit/amtrakFetcher';

beforeEach(() => {
  clearAmtrakCache();
  jest.restoreAllMocks();
});

describe('fetchAmtrakRoutes', () => {
  it('parses BTS GeoJSON MultiLineString routes', async () => {
    const mockResponse = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Acela' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [-77.0142, 38.8836],
                [-77.0137, 38.8835],
                [-77.0136, 38.8835],
              ],
              [
                [-73.993, 40.7505],
                [-73.991, 40.7515],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'Northeast Regional' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-77.014, 38.884],
              [-76.612, 39.102],
              [-75.182, 39.955],
            ],
          },
        },
      ],
    };

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const lines = await fetchAmtrakRoutes(38.5, -77.5, 41.0, -73.5);

    expect(lines).toHaveLength(2);

    // Acela: MultiLineString → 2 segments
    expect(lines[0].id).toBe('bts:amtrak:acela');
    expect(lines[0].name).toBe('Acela');
    expect(lines[0].operator).toBe('Amtrak');
    expect(lines[0].color).toBe('1A4B8D');
    expect(lines[0].mode).toBe('RAIL');
    expect(lines[0].geometry).toHaveLength(2);
    expect(lines[0].geometry[0]).toHaveLength(3);
    expect(lines[0].geometry[1]).toHaveLength(2);

    // Northeast Regional: LineString → 1 segment
    expect(lines[1].id).toBe('bts:amtrak:northeast-regional');
    expect(lines[1].geometry).toHaveLength(1);
    expect(lines[1].geometry[0]).toHaveLength(3);
  });

  it('returns empty array on fetch failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
    const lines = await fetchAmtrakRoutes(40.7, -74.1, 40.85, -73.9);
    expect(lines).toEqual([]);
  });

  it('returns empty array on non-OK response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    const lines = await fetchAmtrakRoutes(40.7, -74.1, 40.85, -73.9);
    expect(lines).toEqual([]);
  });

  it('caches results after first successful fetch', async () => {
    const mockResponse = {
      features: [
        {
          properties: { name: 'Acela' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-73.99, 40.75],
              [-73.98, 40.76],
            ],
          },
        },
      ],
    };

    const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const first = await fetchAmtrakRoutes(40.7, -74.1, 40.85, -73.9);
    expect(first).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second call returns cached — no new fetch
    const second = await fetchAmtrakRoutes(40.7, -74.1, 40.85, -73.9);
    expect(second).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends correct spatial query params', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [] }),
    } as Response);

    await fetchAmtrakRoutes(40.7, -74.1, 40.85, -73.9);

    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('geometry=-74.1%2C40.7%2C-73.9%2C40.85');
    expect(url).toContain('geometryType=esriGeometryEnvelope');
    expect(url).toContain('spatialRel=esriSpatialRelIntersects');
    expect(url).toContain('maxAllowableOffset=0.001');
    expect(url).toContain('f=geojson');
  });
});
