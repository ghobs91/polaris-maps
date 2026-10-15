jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: '',
  PANORAMAX_SEARCH_URL: 'https://panoramax.test/search',
  STREETLEVEL_PANO_SEARCH_URL: 'https://streetlevel.test/SingleImageSearch',
  STREETLEVEL_TILE_BASE_URL: 'https://streetlevel.test/tile',
  STREETLEVEL_THUMBNAIL_BASE_URL: 'https://streetlevel.test/thumbnail',
  STREETLEVEL_USER_AGENT: 'test-agent',
}));

import {
  findStreetViewPanoramas,
  isMapillaryConfigured,
  normalizeMapillary,
  normalizePanoramax,
  sortPanoramasByRecency,
  type StreetViewPanorama,
} from '../../src/services/imagery/streetViewService';

const mockFetch = jest.fn();
const mockConfig = jest.requireMock('../../src/constants/config') as { MAPILLARY_TOKEN: string };

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.MAPILLARY_TOKEN = '';
  global.fetch = mockFetch as unknown as typeof fetch;
});

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

const panoramaxPayload = {
  features: [
    {
      id: 'pano-1',
      geometry: { coordinates: [2.2945, 48.8584] },
      assets: { hd: { href: 'https://panoramax.test/1/hd.jpg' }, thumb: { href: 'th1.jpg' } },
      properties: { license: 'CC-BY-SA-4.0', author: 'Alice', datetime: '2024-01-01T00:00:00Z' },
    },
  ],
};

const mapillaryPayload = {
  data: [
    {
      id: 'mly-1',
      geometry: { coordinates: [2.2946, 48.8585] },
      thumb_2048_url: 'https://mly.test/1.jpg',
      thumb_1024_url: 'https://mly.test/1-1024.jpg',
      captured_at: 1700000000000,
      compass_angle: 90,
      is_pano: true,
      creator: { username: 'bob' },
    },
    {
      id: 'mly-flat',
      geometry: { coordinates: [2.2947, 48.8586] },
      thumb_2048_url: 'https://mly.test/flat.jpg',
      is_pano: false,
    },
  ],
};

// Minimal SingleImageSearch response: [status], then the panorama message.
const googlePayload = [
  [0],
  [
    [1],
    [2, 'gPANO1'],
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
    [[[1], [[null, null, 48.8585, 2.2946], [35, null, 70], [12, 89, 0], null, 'FR'], null, []]],
    [null, null, null, null, null, null, null, [2026, 5]],
  ],
];

/** Route each mock request to the payload its source expects. */
function routeFetch(url: string): Response {
  const target = String(url);
  if (target.includes('SingleImageSearch')) return jsonResponse(googlePayload);
  if (target.includes('mapillary')) return jsonResponse(mapillaryPayload);
  return jsonResponse(panoramaxPayload);
}

describe('normalizePanoramax', () => {
  it('maps STAC features to 360 panoramas with attribution', () => {
    const [pano] = normalizePanoramax(panoramaxPayload);
    expect(pano).toMatchObject({
      id: 'panoramax:pano-1',
      source: 'panoramax',
      isPano: true,
      imageUrl: 'https://panoramax.test/1/hd.jpg',
      attribution: 'Panoramax (CC-BY-SA)',
      contributor: 'Alice',
    });
    expect(pano.lat).toBeCloseTo(48.8584);
    expect(pano.lng).toBeCloseTo(2.2945);
  });

  it('returns nothing for malformed payloads', () => {
    expect(normalizePanoramax({})).toEqual([]);
  });
});

describe('normalizeMapillary', () => {
  it('maps images to panoramas and keeps the pano flag', () => {
    const items = normalizeMapillary(mapillaryPayload);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'mapillary:mly-1',
      isPano: true,
      bearing: 90,
      contributor: 'bob',
      attribution: 'Mapillary (CC-BY-SA)',
    });
    expect(items[1].isPano).toBe(false);
  });

  it('normalizes milliseconds captured_at to epoch seconds', () => {
    // Mapillary reports captured_at in ms (1700000000000); the contract is seconds.
    const [pano] = normalizeMapillary(mapillaryPayload);
    expect(pano.capturedAt).toBe(1_700_000_000);
  });

  it('leaves an already-seconds captured_at untouched', () => {
    const [pano] = normalizeMapillary({
      data: [{ ...mapillaryPayload.data[0], captured_at: 1_700_000_000 }],
    });
    expect(pano.capturedAt).toBe(1_700_000_000);
  });
});

describe('findStreetViewPanoramas', () => {
  it('always queries Google and Panoramax, but not Mapillary without a token', async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(routeFetch(url)));

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(isMapillaryConfigured()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const targets = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(targets.some((t) => t.includes('SingleImageSearch'))).toBe(true);
    expect(targets.some((t) => t.includes('panoramax.test'))).toBe(true);
    expect(result.map((p) => p.source).sort()).toEqual(['google', 'panoramax']);
  });

  it('adds Google Street View with a thumbnail, tiles and Google attribution', async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(routeFetch(url)));
    mockConfig.MAPILLARY_TOKEN = 'test-token';

    const [first] = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(first.id).toBe('google:gPANO1');
    expect(first.source).toBe('google');
    expect(first.isPano).toBe(true);
    expect(first.bearing).toBe(12);
    expect(first.attribution).toBe('Google Street View (© 2026 Google)');
    expect(first.imageUrl).toContain('streetlevel.test/thumbnail');
    // Two stitched levels: zoom 2 (preview) and zoom 3 (full).
    expect(first.tiles?.map((t) => t.zoom)).toEqual([2, 3]);
    expect(first.tiles?.[1]).toMatchObject({ cols: 8, rows: 4, tileSize: 512, width: 4096 });
  });

  it('merges all sources and filters non-pano images', async () => {
    mockConfig.MAPILLARY_TOKEN = 'test-token';
    mockFetch.mockImplementation((url: string) => Promise.resolve(routeFetch(url)));

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(isMapillaryConfigured()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const mapillaryCall = mockFetch.mock.calls.find((c) => String(c[0]).includes('mapillary'));
    expect(String(mapillaryCall?.[0])).toContain('access_token=test-token');
    expect(String(mapillaryCall?.[0])).toContain('fields=');
    // mly-flat is excluded because is_pano is false.
    expect(result.map((p) => p.id).sort()).toEqual([
      'google:gPANO1',
      'mapillary:mly-1',
      'panoramax:pano-1',
    ]);
  });

  it('sorts by distance and caps the result count', async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(routeFetch(url)));
    const result = await findStreetViewPanoramas(48.8584, 2.2945, { limit: 1 });
    expect(result).toHaveLength(1);
  });

  it('puts Google first, then Mapillary, then Panoramax most-recently-captured first', async () => {
    mockConfig.MAPILLARY_TOKEN = 'test-token';
    const panoramaxMulti = {
      features: [
        {
          id: 'old',
          geometry: { coordinates: [2.2945, 48.8584] },
          assets: { hd: { href: 'old.jpg' } },
          properties: { datetime: '2020-01-01T00:00:00Z' },
        },
        {
          id: 'new',
          geometry: { coordinates: [2.2945, 48.8584] },
          assets: { hd: { href: 'new.jpg' } },
          properties: { datetime: '2025-01-01T00:00:00Z' },
        },
        {
          id: 'undated',
          geometry: { coordinates: [2.2945, 48.8584] },
          assets: { hd: { href: 'undated.jpg' } },
          properties: {},
        },
      ],
    };
    mockFetch.mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes('SingleImageSearch')) return Promise.resolve(jsonResponse(googlePayload));
      if (target.includes('mapillary')) return Promise.resolve(jsonResponse(mapillaryPayload));
      return Promise.resolve(jsonResponse(panoramaxMulti));
    });

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(result.map((p) => p.id)).toEqual([
      'google:gPANO1',
      'mapillary:mly-1',
      'panoramax:new',
      'panoramax:old',
      'panoramax:undated',
    ]);
  });

  it('degrades to the other sources when Google fails', async () => {
    mockConfig.MAPILLARY_TOKEN = 'test-token';
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('SingleImageSearch'))
        return Promise.reject(new Error('google down'));
      return Promise.resolve(routeFetch(url));
    });

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(result.map((p) => p.id).sort()).toEqual(['mapillary:mly-1', 'panoramax:pano-1']);
  });

  it('degrades to an empty list when the network fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(findStreetViewPanoramas(48.8584, 2.2945)).resolves.toEqual([]);
  });
});

describe('sortPanoramasByRecency', () => {
  const pano = (id: string, capturedAt?: number): StreetViewPanorama => ({
    id,
    source: id.startsWith('mapillary')
      ? 'mapillary'
      : id.startsWith('google')
        ? 'google'
        : 'panoramax',
    lat: 0,
    lng: 0,
    capturedAt,
    isPano: true,
    imageUrl: `${id}.jpg`,
    attribution: 'test',
  });

  it('orders across sources newest-first and keeps undated captures last', () => {
    const ordered = sortPanoramasByRecency([
      pano('panoramax:2020', 1577836800),
      pano('mapillary:2025', 1735689600),
      pano('panoramax:undated'),
      pano('mapillary:2023', 1672531200),
    ]);

    expect(ordered.map((p) => p.id)).toEqual([
      'mapillary:2025',
      'mapillary:2023',
      'panoramax:2020',
      'panoramax:undated',
    ]);
  });

  it('does not mutate the input list', () => {
    const input = [pano('a', 100), pano('b', 200)];
    const ordered = sortPanoramasByRecency(input);
    expect(input.map((p) => p.id)).toEqual(['a', 'b']);
    expect(ordered).not.toBe(input);
  });
});
