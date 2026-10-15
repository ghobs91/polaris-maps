jest.mock('../../src/constants/config', () => ({
  STREETLEVEL_PANO_SEARCH_URL: 'https://streetlevel.test/SingleImageSearch',
  STREETLEVEL_TILE_BASE_URL: 'https://streetlevel.test/tile',
  STREETLEVEL_THUMBNAIL_BASE_URL: 'https://streetlevel.test/thumbnail',
  STREETLEVEL_USER_AGENT: 'test-agent',
}));

import {
  buildGoogleSearchBody,
  buildTileGrids,
  findGoogleStreetViewPano,
  googlePermalink,
  googleThumbnailUrl,
  googleTileUrlTemplate,
  normalizeGoogleStreetView,
  parseGoogleSearchResponse,
} from '../../src/services/imagery/streetlevelService';

/** Minimal `SingleImageSearch` response: `[status]`, then the message. */
function searchResponse(status = 0): unknown {
  return [
    [status],
    [
      [1],
      [2, 'PANO123'],
      [
        2,
        2,
        [8192, 16384],
        [
          [[[256, 512]], [[512, 1024]], [[1024, 2048]], [[2048, 4096]]],
          [512, 512],
        ],
      ],
      null,
      [[[['© 2026 Google']]]],
      [
        [
          [1],
          [[null, null, 52.52, 13.405], [38, null, 77], [51.86, 89.78, 359.84], null, 'DE'],
          null,
          [],
        ],
      ],
      [null, null, null, null, null, null, null, [2025, 7]],
    ],
  ];
}

describe('normalizeGoogleStreetView', () => {
  it('extracts the panorama id, position, heading, date and copyright', () => {
    const pano = normalizeGoogleStreetView(searchResponse());

    expect(pano).not.toBeNull();
    expect(pano).toMatchObject({
      panoid: 'PANO123',
      lat: 52.52,
      lng: 13.405,
      heading: 51.86,
      copyright: '© 2026 Google',
      tileSize: 512,
    });
    // Official coverage only exposes year/month; day defaults to the 1st.
    expect(pano?.capturedAt).toBe(Math.floor(Date.UTC(2025, 6, 1) / 1000));
  });

  it('parses ascending image sizes as width/height pairs', () => {
    const pano = normalizeGoogleStreetView(searchResponse());
    expect(pano?.imageSizes).toEqual([
      { width: 512, height: 256 },
      { width: 1024, height: 512 },
      { width: 2048, height: 1024 },
      { width: 4096, height: 2048 },
    ]);
  });

  it('returns null when the search reports no imagery (status 5)', () => {
    expect(normalizeGoogleStreetView(searchResponse(5))).toBeNull();
  });

  it('returns null for malformed or incomplete payloads', () => {
    expect(normalizeGoogleStreetView(null)).toBeNull();
    expect(normalizeGoogleStreetView({})).toBeNull();
    expect(normalizeGoogleStreetView([[0], []])).toBeNull();
  });
});

describe('parseGoogleSearchResponse', () => {
  it('strips an XSSI prefix before parsing', () => {
    expect(parseGoogleSearchResponse(")]}'\n[[0]]")).toEqual([[0]]);
  });

  it('returns null on invalid JSON', () => {
    expect(parseGoogleSearchResponse('not json')).toBeNull();
  });
});

describe('buildGoogleSearchBody', () => {
  it('encodes the centre point, radius and official-coverage image type', () => {
    const body = JSON.parse(buildGoogleSearchBody(52.52, 13.405, 400));
    // [centre, radius]
    expect(body[1]).toEqual([[null, null, 52.52, 13.405], 400]);
    // image type 2 = official coverage
    expect(body[2][10]).toEqual([[[2, true, 2]]]);
  });

  it('splits an IETF locale into language and country', () => {
    const body = JSON.parse(buildGoogleSearchBody(0, 0, 50, 'de-AT'));
    expect(body[2][1]).toEqual(['de', 'AT']);
  });
});

describe('URL builders', () => {
  it('builds a tile template with x/y/z placeholders', () => {
    const template = googleTileUrlTemplate('PANO/1');
    expect(template).toContain('streetlevel.test/tile');
    expect(template).toContain('panoid=PANO%2F1');
    expect(template).toContain('{x}');
    expect(template).toContain('{y}');
    expect(template).toContain('{z}');
  });

  it('builds a thumbnail URL with the requested size', () => {
    const url = googleThumbnailUrl('PANO123', { width: 400, height: 200 });
    expect(url).toContain('streetlevel.test/thumbnail');
    expect(url).toContain('panoid=PANO123');
    expect(url).toContain('w=400');
    expect(url).toContain('h=200');
  });

  it('builds a Google Maps permalink containing the pano id', () => {
    const url = googlePermalink({ panoid: 'PANO123', lat: 52.52, lng: 13.405, heading: 12 });
    expect(url).toContain('google.com/maps');
    expect(url).toContain('52.52,13.405');
    expect(url).toContain('PANO123');
  });
});

describe('buildTileGrids', () => {
  const pano = {
    panoid: 'PANO123',
    tileSize: 512,
    imageSizes: [
      { width: 512, height: 256 },
      { width: 1024, height: 512 },
      { width: 2048, height: 1024 },
      { width: 4096, height: 2048 },
    ],
  };

  it('builds the preview and full-quality levels by default', () => {
    const grids = buildTileGrids(pano);
    expect(grids.map((g) => g.zoom)).toEqual([2, 3]);
    expect(grids[0]).toMatchObject({ cols: 4, rows: 2, width: 2048, height: 1024 });
    expect(grids[1]).toMatchObject({ cols: 8, rows: 4, width: 4096, height: 2048 });
  });

  it('clamps requested zooms to the levels the panorama provides', () => {
    const grids = buildTileGrids(pano, [3, 5]);
    // 5 clamps to the highest available level (3), which de-duplicates.
    expect(grids.map((g) => g.zoom)).toEqual([3]);
  });

  it('returns an empty list when there are no image levels', () => {
    expect(buildTileGrids({ panoid: 'x', tileSize: 512, imageSizes: [] })).toEqual([]);
  });
});

describe('findGoogleStreetViewPano', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('POSTs the search body with the protobuf content type', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(searchResponse()),
    } as Response);

    const pano = await findGoogleStreetViewPano(52.52, 13.405);

    expect(pano?.panoid).toBe('PANO123');
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('SingleImageSearch');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json+protobuf');
  });

  it('returns null when the request fails or is rejected', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(findGoogleStreetViewPano(52.52, 13.405)).resolves.toBeNull();

    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(findGoogleStreetViewPano(52.52, 13.405)).resolves.toBeNull();
  });

  it('returns null for non-finite coordinates without fetching', async () => {
    await expect(findGoogleStreetViewPano(NaN, 13.405)).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
