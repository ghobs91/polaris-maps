jest.mock('../../src/constants/config', () => ({
  MAPILLARY_TOKEN: '',
  PANORAMAX_SEARCH_URL: 'https://panoramax.test/search',
}));

import {
  findStreetViewPanoramas,
  isMapillaryConfigured,
  normalizeMapillary,
  normalizePanoramax,
} from '../../src/services/imagery/streetViewService';

const mockFetch = jest.fn();
const mockConfig = jest.requireMock('../../src/constants/config') as { MAPILLARY_TOKEN: string };

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.MAPILLARY_TOKEN = '';
  global.fetch = mockFetch as unknown as typeof fetch;
});

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
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
});

describe('findStreetViewPanoramas', () => {
  it('only queries Panoramax when Mapillary is not configured', async () => {
    mockFetch.mockResolvedValue(jsonResponse(panoramaxPayload));

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(isMapillaryConfigured()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toContain('panoramax.test');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('panoramax');
  });

  it('merges Mapillary (token-gated) and Panoramax, filtering non-pano images', async () => {
    mockConfig.MAPILLARY_TOKEN = 'test-token';
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse(String(url).includes('mapillary') ? mapillaryPayload : panoramaxPayload),
      ),
    );

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(isMapillaryConfigured()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const mapillaryCall = mockFetch.mock.calls.find((c) => String(c[0]).includes('mapillary'));
    expect(String(mapillaryCall?.[0])).toContain('access_token=test-token');
    expect(String(mapillaryCall?.[0])).toContain('fields=');
    // mly-flat is excluded because is_pano is false.
    expect(result.map((p) => p.id).sort()).toEqual(['mapillary:mly-1', 'panoramax:pano-1']);
  });

  it('sorts by distance and caps the result count', async () => {
    mockFetch.mockResolvedValue(jsonResponse(panoramaxPayload));
    const result = await findStreetViewPanoramas(48.8584, 2.2945, { limit: 1 });
    expect(result).toHaveLength(1);
  });

  it('puts Mapillary first, then Panoramax most-recently-captured first', async () => {
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
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse(String(url).includes('mapillary') ? mapillaryPayload : panoramaxMulti),
      ),
    );

    const result = await findStreetViewPanoramas(48.8584, 2.2945);

    expect(result.map((p) => p.id)).toEqual([
      'mapillary:mly-1',
      'panoramax:new',
      'panoramax:old',
      'panoramax:undated',
    ]);
  });

  it('degrades to an empty list when the network fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(findStreetViewPanoramas(48.8584, 2.2945)).resolves.toEqual([]);
  });
});
