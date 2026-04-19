describe('overture proxy helpers', () => {
  it('parses bbox and clamps limit', async () => {
    const proxy = await import('../../backend/overture-proxy.mjs');

    expect(proxy.parseBboxParam('-73.535,40.722,-73.520,40.728')).toEqual({
      west: -73.535,
      south: 40.722,
      east: -73.52,
      north: 40.728,
    });
    expect(proxy.clampLimit('5000')).toBe(1000);
    expect(proxy.clampLimit('0')).toBe(1);
  });

  it('rejects malformed or inverted bbox values', async () => {
    const proxy = await import('../../backend/overture-proxy.mjs');

    expect(proxy.parseBboxParam('')).toEqual({
      error: 'Missing required query parameter: bbox',
    });
    expect(proxy.parseBboxParam('west,south,east,north')).toEqual({
      error: 'bbox must be 4 comma-separated numbers: west,south,east,north',
    });
    expect(proxy.parseBboxParam('-73.520,40.728,-73.535,40.722')).toEqual({
      error: 'bbox must satisfy west < east and south < north',
    });
  });

  it('builds DuckDB args in east west north south order', async () => {
    const proxy = await import('../../backend/overture-proxy.mjs');

    expect(proxy.buildQueryArgs(-73.535, 40.722, -73.52, 40.728, 5)).toEqual([
      -73.52, -73.535, 40.728, 40.722, 5,
    ]);
  });
});
